const fs = require('fs');

const STRAPI_URL = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

const BASE_AUDIO_URL = 'https://tarhelahi.ir/Mohajerat';

const rawFiles = [
  "q1j10.mp3", "q1j1a.mp3", "q1j1b.mp3", "q1j2.m4a", "q1j3.m4a", "q1j4.m4a", "q1j5.mp3", "q1j6.mp3", "q1j7.mp3", "q1j8a.mp3", "q1j8b.mp3", "q1j9.mp3",
  "q2j1.mp3", "q2j10a.mp3", "q2j10b.mp3", "q2j2.mp3", "q2j3.mp3", "q2j4a.mp3", "q2j4b.mp3", "q2j5.mp3", "q2j6.mp3", "q2j7.mp3", "q2j8a.mp3", "q2j8b.mp3", "q2j9a.mp3", "q2j9b.mp3",
  "q3j1.mp3", "q3j10.mp3", "q3j2.mp3", "q3j3.mp3", "q3j4.mp3", "q3j5.mp3", "q3j6.mp3", "q3j7.mp3", "q3j8.mp3", "q3j9.mp3"
];

function parseFileInfo(filename) {
  const match = filename.match(/^[qQ](\d+)[jJ](\d+)([a-zA-Z]*)\.(mp3|m4a)$/i);
  if (!match) return null;
  return {
    filename,
    q: parseInt(match[1], 10),
    j: parseInt(match[2], 10),
    sub: match[3].toLowerCase(),
    ext: match[4].toLowerCase()
  };
}

const parsedList = rawFiles.map(parseFileInfo).filter(Boolean);

const chapterGroups = new Map();
for (const item of parsedList) {
  if (!chapterGroups.has(item.q)) {
    chapterGroups.set(item.q, []);
  }
  chapterGroups.get(item.q).push(item);
}

function formatLessonTitle(j, sub) {
  const parts = [];
  parts.push(`قسمت ${j}`);
  if (sub === 'a') parts.push('بخش اول');
  else if (sub === 'b') parts.push('بخش دوم');
  else if (sub === 'c') parts.push('بخش سوم');
  else if (sub) parts.push(`بخش ${sub}`);
  return parts.join(' - ');
}

const sortedQKeys = Array.from(chapterGroups.keys()).sort((a, b) => a - b);

const chapters = sortedQKeys.map((qNum) => {
  const items = chapterGroups.get(qNum);

  items.sort((a, b) => {
    if (a.j !== b.j) return a.j - b.j;
    return a.sub.localeCompare(b.sub);
  });

  const lessons = items.map(item => ({
    title: formatLessonTitle(item.j, item.sub),
    audioUrl: `${BASE_AUDIO_URL}/${item.filename}`,
    videoUrl: null,
    isFree: false,
    duration: '00:00',
  }));

  return {
    title: `فصل ${qNum}`,
    price: 100000,
    duration: '00:00',
    lessons,
  };
});

const coursePayload = {
  data: {
    title: 'مهاجرت',
    slug: 'mohajerat',
    description: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'مهاجرت یک انتخاب بیرونی است، اما تمام رنج‌ها و مشکلات ما ریشه در دنیای درونمان دارند. تغییر مکان، مانند تعویض آینه است؛ چهره‌ی ما در آینه‌ی جدید هم همان خواهد بود و تا زمانی که درونمان تغییر نکند، مشکلات نیز با ما سفر می‌کنند. حقیقت این است که اگر بهشت را در درون خود نیابیم، هرگز در هیچ نقطه‌ای از این جهان آن را نخواهیم یافت.'
          }
        ]
      }
    ],
    price: 100000,
    isFree: false,
    isChaptered: true,
    teaserUrl: null,
    media: [],
    curriculum: [],
    content: `<h2>دوره آموزشی مهاجرت درون و برون</h2>
<p>مهاجرت فراتر از تغییر موقعیت جغرافیایی، یک تحول عمیق درونی است. در این دوره آموزشی، طی سه فصل منسجم به کالبدشکافی ریشه‌ای ابعاد روانی، فکری و معنوی مهاجرت پرداخته شده است.</p>

<h3>ویژگی‌های دوره:</h3>
<ul>
  <li>تحلیل عمیق انگیزه‌ها و چالش‌های روانی مهاجرت</li>
  <li>جلسات صوتی تفکیک‌شده در ۳ فصل آموزشی</li>
  <li>راهکارهای دستیابی به صلح و ثبات درونی</li>
</ul>`,
    chapters,
  },
};

async function main() {
  console.log(`Prepared ${chapters.length} chapters for 'mohajerat'. Total lessons: ${chapters.reduce((acc, c) => acc + c.lessons.length, 0)}`);

  // Check if course already exists
  const checkRes = await fetch(`${STRAPI_URL}/api/courses?filters[slug]=mohajerat&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const checkData = await checkRes.json();

  if (checkData.data && checkData.data.length > 0) {
    const docId = checkData.data[0].documentId || checkData.data[0].id;
    console.log(`Course with slug 'mohajerat' found (Document ID: ${docId}). Updating...`);

    const updateRes = await fetch(`${STRAPI_URL}/api/courses/${docId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${STRAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(coursePayload),
    });
    const updateData = await updateRes.json();
    console.log('Update status:', updateRes.status);

    // Publish course
    const pubRes = await fetch(`${STRAPI_URL}/api/courses/${docId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Publish status:', pubRes.status);
    return;
  }

  // Create course
  const res = await fetch(`${STRAPI_URL}/api/courses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(coursePayload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to create course:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const documentId = data?.data?.documentId || data?.data?.id;
  console.log(`Course 'mohajerat' successfully created with documentId: ${documentId}`);
}

main().catch(err => {
  console.error('Error executing script:', err);
  process.exit(1);
});
