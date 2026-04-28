// server.js
require('dotenv').config();         // .env 지원 (로컬 개발 편의용)
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 5000;

/**
 * CORS 설정
 * - '*' 대신 필요한 경우에만 오리진을 열도록 수정 가능
 */
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  // Preflight 요청 바로 응답
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// -------------------
// MongoDB 연결
// -------------------
const dbUri = process.env.DB_URI;
if (!dbUri) {
  console.error('ERROR: process.env.DB_URI 가 설정되어 있지 않습니다.');
  process.exit(1);
}

// 최신 Mongoose 권장 옵션 추가[web:35]
mongoose
  .connect(dbUri, {
    // useNewUrlParser, useUnifiedTopology는 최신 버전에선 기본값이지만, 명시해도 무방
    // useNewUrlParser: true,
    // useUnifiedTopology: true,
  })
  .then(() => console.log('✅ MongoDB 연결 성공'))
  .catch((err) => {
    console.error('❌ MongoDB 연결 실패:', err.message);
    process.exit(1);
  });

const flowerSchema = new mongoose.Schema(
  {
    flowername: { type: String, index: true },
    habitat: String,
    binomialName: String,
    classification: String,
    flowername_kr: { type: String, index: true },
  },
  {
    collection: 'flowers',
  }
);

const Flower = mongoose.model('Flower', flowerSchema);

// -------------------
// /flowers: 꽃 상세 정보
// -------------------
app.get('/flowers', async (req, res) => {
  const flowername = req.query.flowername;

  if (!flowername) {
    return res.status(400).json({ error: 'flowername query is required' });
  }

  try {
    // 앞뒤 공백 제거 + 대소문자/한글 모두 대응하게 정규식 사용
    const trimmed = String(flowername).trim();
    const regex = new RegExp(
      `^${trimmed.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`,
      'i'
    );

    const flower = await Flower.findOne({
      $or: [{ flowername: regex }, { flowername_kr: regex }],
    }).lean();

    if (!flower) {
      return res.status(404).json({ error: 'Flower not found' });
    }

    const { flowername: en, habitat, binomialName, classification, flowername_kr } =
      flower;

    return res.json({
      flowername: en,
      habitat,
      binomialName,
      classification,
      flowername_kr,
    });
  } catch (error) {
    console.error('Error retrieving flower information:', error);
    return res.status(500).json({ error: 'An error occurred' });
  }
});

// -------------------
// /naver-shopping: 네이버 쇼핑 검색
// -------------------
app.get('/naver-shopping', async (req, res) => {
  const flowername = req.query.flowername;

  if (!flowername) {
    return res.status(400).json({ error: 'flowername query is required' });
  }

  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'Naver API credentials (CLIENT_ID/CLIENT_SECRET) are not set',
    });
  }

  // 네이버 검색 API는 display 최대 100, start 최대 1000 제한[web:31][web:37]
  const displayPerPage = 100;
  const maxStart = 1000;

  async function fetchNaverShoppingResults() {
    let start = 1;
    const allResults = [];

    while (start <= maxStart) {
      const apiUrl = 'https://openapi.naver.com/v1/search/shop.json';

      try {
        const response = await axios.get(apiUrl, {
          params: {
            query: flowername,
            display: displayPerPage,
            start,
            sort: 'sim',
          },
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
          },
        });

        const data = response.data;
        const items = data.items || [];

        if (items.length === 0) {
          break; // 더 이상 결과 없음
        }

        allResults.push(...items);

        // 다음 페이지로
        start += displayPerPage;

        // total 값 기준으로 추가 요청 필요 없는 경우 조기 종료
        if (data.total && start > data.total) {
          break;
        }
      } catch (error) {
        console.error('네이버 쇼핑 API 오류:', error.response?.data || error.message);
        // API 에러 발생 시 전체 중단
        throw new Error('Naver Shopping API error');
      }
    }

    return allResults;
  }

  try {
    const items = await fetchNaverShoppingResults();
    console.log(`총 ${items.length}개의 검색 결과를 가져왔습니다.`);
    // 필요한 필드만 내려주고 싶다면 여기서 map으로 가공
    return res.json({ items });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Naver Shopping API error' });
  }
});

// -------------------
// 서버 실행
// -------------------
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});