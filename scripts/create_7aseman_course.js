const fs = require('fs');

const STRAPI_URL = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

const BASE_AUDIO_URL = 'https://dl.tarhelahi.ir/7Aseman';

// Chapter 1 Lessons
const chapter1Lessons = [
  { title: 'قسمت 1', audioUrl: `${BASE_AUDIO_URL}/q1j1.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 2', audioUrl: `${BASE_AUDIO_URL}/q1j2.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 3', audioUrl: `${BASE_AUDIO_URL}/q1j3.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 4 - بخش اول', audioUrl: `${BASE_AUDIO_URL}/q1j4a.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 4 - بخش دوم', audioUrl: `${BASE_AUDIO_URL}/q1j4b.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 5', audioUrl: `${BASE_AUDIO_URL}/q1j5.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 6', audioUrl: `${BASE_AUDIO_URL}/q1j6.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 7', audioUrl: `${BASE_AUDIO_URL}/q1j7.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 8', audioUrl: `${BASE_AUDIO_URL}/q1j8.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 9', audioUrl: `${BASE_AUDIO_URL}/q1j9.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 10', audioUrl: `${BASE_AUDIO_URL}/q1j10.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
];

// Chapter 2 Lessons
const chapter2Lessons = [
  { title: 'قسمت 1', audioUrl: `${BASE_AUDIO_URL}/q2j1.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 2 - بخش اول', audioUrl: `${BASE_AUDIO_URL}/q2j2a.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 2 - بخش دوم', audioUrl: `${BASE_AUDIO_URL}/q2j2b.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 3', audioUrl: `${BASE_AUDIO_URL}/q2j3.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 4', audioUrl: `${BASE_AUDIO_URL}/q2j4.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 5', audioUrl: `${BASE_AUDIO_URL}/q2j5.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 6', audioUrl: `${BASE_AUDIO_URL}/q2j6.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 7', audioUrl: `${BASE_AUDIO_URL}/q2j7.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 8', audioUrl: `${BASE_AUDIO_URL}/q2j8.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 9', audioUrl: `${BASE_AUDIO_URL}/q2j9.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 10', audioUrl: `${BASE_AUDIO_URL}/q2j10.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
];

// Chapter 3 Lessons
const chapter3Lessons = [
  { title: 'قسمت 1', audioUrl: `${BASE_AUDIO_URL}/q3j1.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 2', audioUrl: `${BASE_AUDIO_URL}/q3j2.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 3', audioUrl: `${BASE_AUDIO_URL}/q3j3.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 4', audioUrl: `${BASE_AUDIO_URL}/q3j4.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 10', audioUrl: `${BASE_AUDIO_URL}/q3j10.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 11', audioUrl: `${BASE_AUDIO_URL}/q3j11.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 12 - بخش اول', audioUrl: `${BASE_AUDIO_URL}/q3j12a.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 12 - بخش دوم', audioUrl: `${BASE_AUDIO_URL}/q3j12b.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 13 - بخش اول', audioUrl: `${BASE_AUDIO_URL}/q3j13a.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 13 - بخش دوم', audioUrl: `${BASE_AUDIO_URL}/q3j13b.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 14 - بخش اول', audioUrl: `${BASE_AUDIO_URL}/q3j14a.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
  { title: 'قسمت 14 - بخش دوم', audioUrl: `${BASE_AUDIO_URL}/q3j14b.mp3`, videoUrl: null, isFree: false, duration: '00:00' },
];

const coursePayload = {
  data: {
    title: 'هفت آسمان',
    slug: '7aseman',
    description: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'دوره جامع هفت آسمان؛ سفری معرفتی و گام‌به‌گام در مسیر شناخت مراتب وجودی، بیداری آگاهی و ارتقای بینش با درس‌گفتارهای صوتی اختصاصی در سه فصل جامع آموزشی.'
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
    content: `<h2>دوره آموزشی هفت آسمان</h2>
<p>دوره هفت آسمان یک مسیر عمیق و منسجم برای درک عوالم درونی و دستیابی به آرامش و آگاهی پایدار است. در این دوره آموزشی، جلسات به صورت فایل‌های صوتی تفکیک‌شده و منظم در سه فصل تدوین شده‌اند تا مخاطب بتواند گام به گام در این مسیر رشد و خودآگاهی گام بردارد.</p>

<h3>ویژگی‌های شاخص دوره:</h3>
<ul>
  <li>آموزش طبقه‌بندی شده در ۳ فصل جامع</li>
  <li>دسترسی به فایل‌های صوتی با کیفیت بالا برای هر جلسه</li>
  <li>امکان گوش دادن مداوم و تعمیق در آموزه‌ها</li>
</ul>

<h3>ساختار فصل‌های آموزشی:</h3>
<ul>
  <li><strong>فصل اول:</strong> مبانی و پایه‌های آغازین مسیر هفت آسمان (۱۱ جلسه صوتی)</li>
  <li><strong>فصل دوم:</strong> ورود به لایه‌های عمیق‌تر درک وجودی (۱۱ جلسه صوتی)</li>
  <li><strong>فصل سوم:</strong> تکامل، تثبیت آگاهی و یکپارچگی معنوی (۱۲ جلسه صوتی)</li>
</ul>`,
    chapters: [
      {
        title: 'فصل 1',
        price: 100000,
        duration: '00:00',
        lessons: chapter1Lessons,
      },
      {
        title: 'فصل 2',
        price: 100000,
        duration: '00:00',
        lessons: chapter2Lessons,
      },
      {
        title: 'فصل 3',
        price: 100000,
        duration: '00:00',
        lessons: chapter3Lessons,
      },
    ],
  },
};

async function main() {
  console.log('Sending request to Strapi to create course 7aseman...');

  // 1. First check if course already exists
  const checkRes = await fetch(`${STRAPI_URL}/api/courses?filters[slug]=7aseman&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const checkData = await checkRes.json();

  if (checkData.data && checkData.data.length > 0) {
    const docId = checkData.data[0].documentId || checkData.data[0].id;
    console.log(`Course with slug '7aseman' already exists (Document ID: ${docId}). Updating...`);

    const updateRes = await fetch(`${STRAPI_URL}/api/courses/${docId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${STRAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(coursePayload),
    });
    const updateData = await updateRes.json();
    console.log('Update result:', JSON.stringify(updateData, null, 2));

    // Publish
    const publishRes = await fetch(`${STRAPI_URL}/api/courses/${docId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Publish result status:', publishRes.status);
    return;
  }

  // 2. Create course
  const res = await fetch(`${STRAPI_URL}/api/courses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(coursePayload),
  });

  const data = await res.json();
  console.log('Creation response:', JSON.stringify(data, null, 2));

  if (!res.ok) {
    console.error('Failed to create course:', data);
    process.exit(1);
  }

  const documentId = data?.data?.documentId || data?.data?.id;
  console.log(`Course created with documentId: ${documentId}`);

  // 3. Publish course
  if (documentId) {
    console.log(`Publishing course ${documentId}...`);
    const pubRes = await fetch(`${STRAPI_URL}/api/courses/${documentId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    const pubData = await pubRes.json();
    console.log('Publish response:', JSON.stringify(pubData, null, 2));
  }
}

main().catch(err => {
  console.error('Error in script:', err);
  process.exit(1);
});
