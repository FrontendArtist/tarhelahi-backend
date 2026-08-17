const fs = require('fs');

const STRAPI_URL = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

const BASE_AUDIO_URL = 'https://tarhelahi.ir/Khakbeaflak';

const rawFiles = [
  "Q1j1.mp3", "Q1j10.mp3", "Q1j2.mp3", "Q1j3.mp3", "Q1j4.mp3", "Q1j5.mp3", "Q1j6.mp3", "Q1j7.mp3", "Q1j8.mp3", "Q1j9.mp3",
  "Q2j1.mp3", "Q2j2.mp3", "Q2j3.mp3", "Q2j4.mp3", "Q2j5.mp3", "Q2j6.mp3", "Q2j7.mp3", "Q2j8.mp3", "Q2j9.mp3",
  "Q3j1.mp3", "Q3j2.mp3", "Q3j3.mp3", "Q3j4.mp3", "Q3j5.mp3", "Q3j6.mp3", "Q3j7.mp3", "Q3j8.mp3", "Q3j9.mp3",
  "Q4j1.mp3", "Q4j10.mp3", "Q4j2.mp3", "Q4j3.mp3", "Q4j4.mp3", "Q4j5.mp3", "Q4j6.mp3", "Q4j7.mp3", "Q4j8.mp3", "Q4j9.mp3",
  "Q5j1.mp3", "Q5j2.mp3", "Q5j3.mp3",
  "Q7j1.mp3", "Q7j10.mp3", "Q7j2.mp3", "Q7j3.mp3", "Q7j4.mp3", "Q7j5.mp3", "Q7j6.mp3", "Q7j7.mp3", "Q7j8.mp3", "Q7j9.mp3",
  "q10j1.mp3", "q10j10.mp3", "q10j2a.mp3", "q10j2b.mp3", "q10j3.mp3", "q10j4a.mp3", "q10j4b.mp3", "q10j5a.mp3", "q10j5b.mp3", "q10j6a.mp3", "q10j6b.mp3", "q10j7a.mp3", "q10j7b.mp3", "q10j8a.mp3", "q10j8b.mp3", "q10j9a.mp3", "q10j9b.mp3",
  "q11j10a.mp3", "q11j10b.mp3", "q11j1a.mp3", "q11j1b.mp3", "q11j2a.mp3", "q11j2b.mp3", "q11j3.mp3", "q11j5.mp3", "q11j6.mp3", "q11j7.mp3", "q11j8a.mp3", "q11j8b.mp3", "q11j9.mp3",
  "q13j10a.mp3", "q13j10b.mp3", "q13j1a.mp3", "q13j1b.mp3", "q13j2.m4a", "q13j3.mp3", "q13j4a.mp3", "q13j4b.mp3", "q13j5a.m4a", "q13j5b.m4a", "q13j6a.mp3", "q13j6b.mp3", "q13j7a.mp3", "q13j7b.mp3", "q13j8.mp3", "q13j9.mp3",
  "q14j10.m4a", "q14j1a.mp3", "q14j1b.mp3", "q14j2a.mp3", "q14j2b.mp3", "q14j3a.m4a", "q14j3b.m4a", "q14j4a.m4a", "q14j4b.m4a", "q14j4c.m4a", "q14j5a.m4a", "q14j5b.m4a", "q14j6a.m4a", "q14j6b.m4a", "q14j7.m4a", "q14j8a.m4a", "q14j8b.m4a", "q14j9.m4a",
  "q15j1.mp3", "q15j10.mp3", "q15j2.mp3", "q15j3.mp3", "q15j4.mp3", "q15j5.mp3", "q15j6.mp3", "q15j7.mp3", "q15j8.mp3", "q15j9.mp3",
  "q5j1.mp3", "q5j10.mp3", "q5j2.mp3", "q5j3.mp3", "q5j4.mp3", "q5j5.mp3", "q5j6.mp3", "q5j7.mp3", "q5j8.mp3", "q5j9.mp3",
  "q6j1.mp3", "q6j10.mp3", "q6j2.mp3", "q6j3.mp3", "q6j4.mp3", "q6j5.mp3", "q6j6.mp3", "q6j7.mp3", "q6j8.mp3", "q6j9.mp3",
  "q8j1.mp3", "q8j10.mp3", "q8j2.mp3", "q8j3.mp3", "q8j5.mp3", "q8j6.mp3", "q8j7.mp3", "q8j8.mp3", "q8j9.mp3",
  "q9j1.mp3", "q9j10a.mp3", "q9j10b.mp3", "q9j2.mp3", "q9j3.mp3", "q9j4.mp3", "q9j5.mp3", "q9j6.mp3", "q9j7.mp3", "q9j8.mp3", "q9j9a.mp3", "q9j9b.mp3"
];

// Deduplicate files case-insensitively while preserving original file casing
const uniqueFilesMap = new Map();
for (const file of rawFiles) {
  const key = file.toLowerCase();
  if (!uniqueFilesMap.has(key)) {
    uniqueFilesMap.set(key, file);
  }
}
const uniqueFiles = Array.from(uniqueFilesMap.values());

// Helper function to parse Q number, J number, subpart (a,b,c), extension
function parseFileInfo(filename) {
  // e.g. Q1j10.mp3 or q10j2a.mp3 or q13j2.m4a
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

const parsedList = uniqueFiles.map(parseFileInfo).filter(Boolean);

// Group by Q number
const chapterGroups = new Map();
for (const item of parsedList) {
  if (!chapterGroups.has(item.q)) {
    chapterGroups.set(item.q, []);
  }
  chapterGroups.get(item.q).push(item);
}

// Helper to format lesson title
function formatLessonTitle(j, sub) {
  const parts = [];
  parts.push(`قسمت ${j}`);
  if (sub === 'a') parts.push('بخش اول');
  else if (sub === 'b') parts.push('بخش دوم');
  else if (sub === 'c') parts.push('بخش سوم');
  else if (sub) parts.push(`بخش ${sub}`);
  return parts.join(' - ');
}

// Sort Q keys numerically
const sortedQKeys = Array.from(chapterGroups.keys()).sort((a, b) => a - b);

const chapters = sortedQKeys.map((qNum) => {
  const items = chapterGroups.get(qNum);

  // Sort items inside chapter by j number, then subpart
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
    title: 'خاک به افلاک',
    slug: 'khakbeaflak',
    description: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: 'دوره جامع خاک به افلاک؛ سفری تکاملی و معنوی برای تعالی روح، رهایی از محدودیت‌های مادی و رسیدن به آگاهی و معرفت والای انسانی با مجموعه کامل درس‌گفتارهای صوتی.'
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
    content: `<h2>دوره آموزشی خاک به افلاک</h2>
<p>دوره «خاک به افلاک» یک مسیر سیر و سلوک معنوی و خودشناسی عمیق است که آموزه‌ها و درس‌گفتارهای آن در فصل‌های متعدد تدوین شده است تا دانش‌پژوهان بتوانند قدم به قدم مراحل بیداری و سیر وجودی را طی نمایند.</p>

<h3>ویژگی‌های دوره:</h3>
<ul>
  <li>پوشش کامل مباحث معرفتی در سرفصل‌های تفکیک‌شده</li>
  <li>فایل‌های صوتی باکیفیت جلسات آموزشی</li>
  <li>منظم‌سازی دقیق جلسات و بخش‌های مکمل</li>
</ul>`,
    chapters,
  },
};

async function main() {
  console.log(`Prepared ${chapters.length} chapters for 'khakbeaflak'. Total lessons: ${chapters.reduce((acc, c) => acc + c.lessons.length, 0)}`);

  // Check if course already exists
  const checkRes = await fetch(`${STRAPI_URL}/api/courses?filters[slug]=khakbeaflak&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  const checkData = await checkRes.json();

  if (checkData.data && checkData.data.length > 0) {
    const docId = checkData.data[0].documentId || checkData.data[0].id;
    console.log(`Course with slug 'khakbeaflak' already exists (Document ID: ${docId}). Updating...`);

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
  console.log(`Course 'khakbeaflak' successfully created with documentId: ${documentId}`);
}

main().catch(err => {
  console.error('Error executing script:', err);
  process.exit(1);
});
