const fs = require('fs');

const STRAPI_URL = process.env.STRAPI_URL || 'http://127.0.0.1:1337';
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '556908b5b31d277f72f8673f99a8ba91c850b70503df4b184910dcaeb4cea77398fb3c1de847cb1369e1c76b836331e1c11ef5c95c3311d8aa30380e60fd08bce4c7a2cf11ab76c1325ba530d381235b0b1265f08de545a863fc5ca842d03627628dd1ac77dfe01dd54c34088905e43477596358994a19929e892b8fc1be377a';

const BASE_AUDIO_URL = 'https://tarhelahi.ir/Saye';
const BASE_VIDEO_URL = 'https://tarhelahi.ir/Saye/videos';

const rawAudioFiles = [
  "saye1.mp3",
  "saye2.mp3",
  "saye3.mp3",
  "saye4.mp3",
  "saye5.mp3",
  "saye6.mp3",
  "saye7.mp3"
];

const curriculum = rawAudioFiles.map((audioFile, index) => {
  const lessonNumber = index + 1;
  return {
    title: `قسمت ${lessonNumber}`,
    audioUrl: `${BASE_AUDIO_URL}/${audioFile}`,
    videoUrl: `${BASE_VIDEO_URL}/j${lessonNumber}.mp4`,
    isFree: false,
    duration: '00:00',
  };
});

const coursePayload = {
  data: {
    title: 'سایه ها | نیمه تاریک وجود',
    slug: 'shadows',
    isChaptered: false,
    chapters: [],
    curriculum,
    publishedAt: new Date().toISOString(),
  },
};

async function main() {
  console.log(`Prepared ${curriculum.length} lessons in curriculum for 'shadows' course...`);

  // Find course by slug 'shados' or 'shadows'
  let checkRes = await fetch(`${STRAPI_URL}/api/courses?filters[slug][$in][0]=shados&filters[slug][$in][1]=shadows&status=draft`, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  let checkData = await checkRes.json();

  if (checkData.data && checkData.data.length > 0) {
    const docId = checkData.data[0].documentId || checkData.data[0].id;
    console.log(`Course found (Document ID: ${docId}). Updating to 'shadows'...`);

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

  // If not found, create new
  console.log("Course not found. Creating new course 'shadows'...");
  const res = await fetch(`${STRAPI_URL}/api/courses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(coursePayload),
  });

  const data = await res.json();
  console.log('Creation status:', res.status);
}

main().catch(err => {
  console.error('Error executing script:', err);
  process.exit(1);
});
