const STRAPI_URL = process.env.STRAPI_URL || 'https://api.tarhelahi.ir';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

async function fixOnlineCourseUrls() {
  console.log(`Fetching all courses from online Strapi (${STRAPI_URL})...`);

  const res = await fetch(`${STRAPI_URL}/api/courses?populate[chapters][populate][lessons]=*&populate[curriculum]=*&pagination[limit]=100&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await res.json();
  if (!res.ok || !body.data) {
    console.error('Failed to fetch online courses:', body);
    process.exit(1);
  }

  const courses = body.data;
  console.log(`Found ${courses.length} courses on online Strapi.`);

  function replaceUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return urlStr;
    return urlStr
      .replace(/https:\/\/dl\.tarhelahi\.ir/g, 'https://tarhelahi.ir') // normalize
      .replace(/https:\/\/tarhelahi\.ir/g, 'https://dl.tarhelahi.ir'); // set to dl
  }

  for (const course of courses) {
    const docId = course.documentId || course.id;
    let needsUpdate = false;

    // Check chapters
    let chapters = course.chapters || [];
    if (Array.isArray(chapters) && chapters.length > 0) {
      chapters = chapters.map(ch => ({
        title: ch.title,
        price: ch.price,
        duration: ch.duration || '00:00',
        lessons: (ch.lessons || []).map(l => {
          const newAudio = replaceUrl(l.audioUrl);
          const newVideo = replaceUrl(l.videoUrl);
          if (newAudio !== l.audioUrl || newVideo !== l.videoUrl) {
            needsUpdate = true;
          }
          return {
            title: l.title,
            isFree: Boolean(l.isFree),
            duration: l.duration || '00:00',
            audioUrl: newAudio,
            videoUrl: newVideo,
          };
        }),
      }));
    }

    // Check curriculum
    let curriculum = course.curriculum || [];
    if (Array.isArray(curriculum) && curriculum.length > 0) {
      curriculum = curriculum.map(l => {
        const newAudio = replaceUrl(l.audioUrl);
        const newVideo = replaceUrl(l.videoUrl);
        if (newAudio !== l.audioUrl || newVideo !== l.videoUrl) {
          needsUpdate = true;
        }
        return {
          title: l.title,
          isFree: Boolean(l.isFree),
          duration: l.duration || '00:00',
          audioUrl: newAudio,
          videoUrl: newVideo,
        };
      });
    }

    const newTeaser = replaceUrl(course.teaserUrl);
    if (newTeaser !== course.teaserUrl) needsUpdate = true;

    if (needsUpdate) {
      console.log(`Updating course '${course.title}' (slug: ${course.slug}, docId: ${docId})...`);

      const updatePayload = {
        data: {
          title: course.title,
          slug: course.slug,
          description: course.description,
          price: course.price,
          isFree: course.isFree,
          isChaptered: course.isChaptered,
          teaserUrl: newTeaser,
          content: course.content,
          chapters,
          curriculum,
          publishedAt: new Date().toISOString(),
        },
      };

      const putRes = await fetch(`${STRAPI_URL}/api/courses/${docId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${STRAPI_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      });

      const putData = await putRes.json();
      console.log(`Update result for ${course.slug}: status ${putRes.status}`);
    } else {
      console.log(`Course '${course.title}' (slug: ${course.slug}) already up-to-date.`);
    }
  }

  console.log('Online Strapi URL replacement complete!');
}

fixOnlineCourseUrls().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
