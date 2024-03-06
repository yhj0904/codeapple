const router = require("express").Router();

let connectDB = require('./../database.js')

let db;
connectDB
  .then((client) => {
    console.log("DB연결성공");
    db = client.db("forum");
  })
  .catch((err) => {
    console.log(err);
  });


router.get("/shirts", async (req, res) => {
   await db.collection('post').find().toArray()
  res.send("test셔츠");
});

router.get("/pants", (req, res) => {
  res.send("test바지");
});

module.exports = router;

// require 대신에 import 사용가능
// 관련있는 API는 URL을 비슷하게 만들어서 파일을따로뺴야한다.
// CRUD를 C /post POSt  ,  R /post GET ,  U /post PUT   , D /post DELETE
// 다른 파일엔 DB가 연결되어있지 않아서 에러남.
//상호 참조 x
//파일마다 DB연결을 하면 안됨. DB파일을 따로 뺴기.
