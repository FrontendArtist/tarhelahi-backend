const fs = require('fs');

const STRAPI_URL = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

const BASE_AUDIO_URL = 'https://dl.tarhelahi.ir/Radiobidari';

const rawAudioFiles = [
  "Ep1.mp3",
  "Ep2.mp3",
  "Ep3.mp3",
  "Ep4.mp3"
];

const curriculum = rawAudioFiles.map((audioFile, index) => {
  const episodeNumber = index + 1;
  return {
    title: `اپیزود ${episodeNumber}`,
    audioUrl: `${BASE_AUDIO_URL}/${audioFile}`,
    videoUrl: null,
    isFree: true,
    duration: '00:00',
  };
});

const coursePayload = {
  data: {
    title: 'رادیو بیداری',
    slug: 'radiobidari',
    description: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'پادکست اختصاصی رادیو بیداری؛ اپیزودهای صوتی شنیدنی برای بیداری آگاهی، الهام‌بخشی درونی و تعمیق بینش معرفتی به صورت کاملاً رایگان.'
          }
        ]
      }
    ],
    price: 0,
    isFree: true,
    isChaptered: false,
    teaserUrl: null,
    media: [],
    chapters: [],
    curriculum,
    content: `<h2>پادکست صوتی رادیو بیداری</h2>
<p>«رادیو بیداری» یک مجموعه پادکست رایگان و الهام‌بخش است که با هدف افزایش آگاهی درونی، آرامش روان و ژرف‌اندیشی در مباحث معنوی تولید شده است.</p>

<h3>ویژگی‌های رادیو بیداری:</h3>
<ul>
  <li>دسترسی ۱۰۰٪ رایگان به تمامی اپیزودها</li>
  <li>کیفیت صوتی بالا و اجرای شنیدنی</li>
  <li>محتوای موجز و تاثیرگذار در قالب پادکست</li>
</ul>`,
    publishedAt: new Date().toISOString(),
  },
};

async function main() {
  console.log(`Sending request to Strapi to create 'radiobidari' course with ${curriculum.length} episodes...`);

  const checkRes = await fetch(`${STRAPI_URL}/api/courses?filters[slug]=radiobidari&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const checkData = await checkRes.json();

  if (checkData.data && checkData.data.length > 0) {
    const docId = checkData.data[0].documentId || checkData.data[0].id;
    console.log(`Course with slug 'radiobidari' already exists (Document ID: ${docId}). Updating...`);

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
  console.log(`Course 'radiobidari' successfully created with documentId: ${documentId}`);
}

main().catch(err => {
  console.error('Error executing script:', err);
  process.exit(1);
});
