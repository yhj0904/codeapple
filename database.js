const { MongoClient } = require("mongodb");

const url = process.env.DB_URL;
let connectDB = new MongoClient(url).connect();
module.exports = connectDB;

// 이부분만 따로 빼는 이유는 이부분이 끝나야함 데이터 처리가 늦기 떄문에
// 이부분만 따로.
