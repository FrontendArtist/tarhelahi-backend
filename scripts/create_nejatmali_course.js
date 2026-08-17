const fs = require('fs');

const STRAPI_URL = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

const BASE_AUDIO_URL = 'https://tarhelahi.ir/Mali';

const rawAudioFiles = [
  "mali1.mp3",
  "mali2.mp3",
  "mali3.mp3",
  "mali4.mp3",
  "mali5.mp3",
  "mali6.mp3",
  "mali7.mp3",
  "mali8.mp3",
  "mali9.mp3"
];

const curriculum = rawAudioFiles.map((audioFile, index) => {
  const lessonNumber = index + 1;
  return {
    title: `قسمت ${lessonNumber}`,
    audioUrl: `${BASE_AUDIO_URL}/${audioFile}`,
    videoUrl: null,
    isFree: false,
    duration: '00:00',
  };
});

const coursePayload = {
  data: {
    title: 'نجات از مشکلات مالی',
    slug: 'nejatmali',
    description: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'دوره جامع نجات از مشکلات مالی؛ آموزش کاربردی و گام‌به‌گام رهایی از دغدغه‌های مالی، تغییر ذهنیت نسبت به فراوانی و خلق برکت و ثروت در زندگی با ۹ درس‌گفتار صوتی اختصاصی.'
          }
        ]
      }
    ],
    price: 100000,
    isFree: false,
    isChaptered: false,
    teaserUrl: null,
    media: [],
    chapters: [],
    curriculum,
    content: `<h2>دوره آموزشی نجات از مشکلات مالی</h2>
<p>مشکلات مالی تنها یک مسئله حسابداری یا درآمدی نیستند، بلکه ریشه در ذهنیت، باورهای ناخودآگاه و الگوهای درونی انسان دارند. در این دوره آموزشی طی ۹ جلسه صوتی، راهکارهای عملی و معرفتی برای عبور از گره‌های مالی ارائه شده است.</p>

<h3>ویژگی‌های دوره:</h3>
<ul>
  <li>تحلیل باورهای بازدارنده مالی و بازبرنامه‌ریزی ذهن</li>
  <li>۹ جلسه فایل صوتی با کیفیت عالی</li>
  <li>آموزش قوانین معنوی و درونی جذب روزی و برکت</li>
</ul>`,
    publishedAt: new Date().toISOString(),
  },
};

async function main() {
  console.log(`Sending request to Strapi to create 'nejatmali' course with ${curriculum.length} lessons...`);

  // Check if course already exists
  const checkRes = await fetch(`${STRAPI_URL}/api/courses?filters[slug]=nejatmali&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const checkData = await checkRes.json();

  if (checkData.data && checkData.data.length > 0) {
    const docId = checkData.data[0].documentId || checkData.data[0].id;
    console.log(`Course with slug 'nejatmali' already exists (Document ID: ${docId}). Updating...`);

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
  console.log(`Course 'nejatmali' successfully created with documentId: ${documentId}`);
}

main().catch(err => {
  console.error('Error executing script:', err);
  process.exit(1);
});
