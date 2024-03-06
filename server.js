const express = require("express");
const app = express();
const {
  MongoClient,
  ObjectId,
  ServerHeartbeatStartedEvent,
} = require("mongodb");
const methodOverride = require("method-override");
const bcrypt = require("bcrypt");
const { createServer } = require("http");
const { Server } = require("socket.io");
const server = createServer(app);
const io = new Server(server);

require("dotenv").config();

app.use(methodOverride("_method"));
app.use(express.static(__dirname + "/public"));
app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const MongoStore = require("connect-mongo");

const { S3Client } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const connectDB = require("./database.js");
const s3 = new S3Client({
  region: "ap-northeast-2",
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: "codeappleforum",
    key: function (요청, file, cb) {
      cb(null, Date.now().toString()); //업로드시 파일명 변경가능
    },
  }),
});
app.use(passport.initialize());
app.use(
  session({
    secret: "암호화에 쓸 비번", //세션 만들떄. ==env
    resave: false, //유저가 서버에 요청할떄 갱신?
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }, //ms 단위  이건 1시간. ==env
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,
      dbName: "forum",
    }),
  })
);
app.use(passport.session());
app.use("/list", (req, res, next) => {
  // use함수 안에 직접 함수작성 가능 람다함수.
  console.log(new Date());
  next();
}); // 시간 출력

function checkIdPw(req, res, next) {
  if (req.body.username == "" || req.body.password == "") {
    res.send("hey, just input gogo");
  } else {
    next();
  }
}

let db;
let changeStream ;
connectDB
  .then((client) => {
    console.log("DB연결성공");
    db = client.db("forum");
    let condition = [
      //{$match : {'fullDocument.title' : 'test'}},  // 타이틀이 test일떄만 추적
      {$match : {operationType : 'insert'}} // document가 insert 될떄만~
    ]  //watch 안에 넣음.
  
    changeStream = db.collection('post').watch(condition)   //change stream. 'post' collection에 실시간 데이터 변화를 추적.
  
    server.listen(process.env.PORT, () => {
      console.log("http://localhost:8080 에서 서버 실행중");
    });
  })
  .catch((err) => {
    console.log(err);
  });

function checkLogin(req, res, next) {
  // next는 함수 형태로 사용 미들웨어 실행 종료시 다음으로 이동
  if (!req.user) {
    res.send("login gogo"); //응답을 해버리면 남은 코드 실행불가
  }
  next(); // 이게 없으면 무한대기 상태. like return
}

//app.use(/* '/URL', 예외처리하는법. 하위까지 적용됨.*/ checkLogin); // 이코드 아래에있는 모든 API는 () 안 미들웨어 적용됨. 미들웨어 일괄등록 상단에 위치하는게 좋음

//미들웨어로 삽입할경우 파라미터 3개, 미들웨어는 []를 사용해 여러개 사용가능. 순서대로.
app.get(
  "/",
  /*checkLogin, 으로 사용가능.*/ (req, res) => {
    //미들웨어. 중간에 꽂은 checkLogin 코드는 요청과 응답 사이에 실행된다. ex) API호출시 함수가 실행되고 코드가실행됨
    res.sendFile(__dirname + "/index.html");
  }
);

app.get("/news", (req, res) => {
  db.collection("post").insertOne({ title: "test" });
});

app.get("/time", (req, res) => {
  res.render("serverTime.ejs", { serverTime: new Date() });
});

app.get("/write", checkLogin, (req, res) => {
  res.render("write.ejs");
});

app.get("/list", async (req, res) => {
  let result = await db.collection("post").find().toArray(); // awite는 코드를 실행될떄까지 기다려달라~~
  //console.log(result[0].title)                    // 응답(res)은 한번만 실행가능. 2개있을때 위에있는것만 실행되고 아래는 x
  res.render("list.ejs", { posts: result }); //object 자료형으로 집어넣는다.
});

//이미지 업로드할때 multer/formidable
app.post("/add", upload.array("img"), async (req, res) => {
  // upload.array('img'/*, 갯수입력하면 limit 값*/)(req,res,(err)=>{
  //   if(err) return res.send('err~~~~')
  // })
  try {
    if (req.body.title == "") {
      res.send("제목 입력 하3");
    } else {
      await db.collection("post").insertOne({
        title: req.body.title,
        content: req.body.content,
        img: req.file ? req.file.location : "",
        user: req.user._id,
        username: req.user.username, //RDB에선 유저의 ObjerctID만 저장. 유저이름이 필요하면 JOIN하면댐 정확학 정보가 필요하면 findOne()2번 or $lookup
      }); //NoSQL에선 이문제를 해결하지 않고 모든 데이터 저장 , 업뎃이 안되면 정보가 부정확할수도. 입출력속도빠름.
      res.redirect("/list");
    }
  } catch (error) {
    console.log(e);
    res.status(500).send("server error");
  }
});

app.get("/detail/:id", async (req, res) => {
  try {
    let commentResult = await db
      .collection("comment")
      .find({ parentId: new ObjectId(req.params.id) }) // 인덱스 만드는게 좋음
      .toArray();

    let result = await db
      .collection("post")
      .findOne({ _id: new ObjectId(req.params.id) });
    if (result == null) {
      res.status(404).send("wrong URL");
    }
    res.render("detail.ejs", { result: result, commentResult: commentResult });
  } catch (error) {
    console.log(error);
    res.status(404).send("wrong URL");
  }
});

app.get("/edit/:id", async (req, res) => {
  let result = await db
    .collection("post")
    .findOne({ _id: new ObjectId(req.params.id) });
  res.render("edit.ejs", { result: result });
});

app.put("/edit", async (req, res) => {
  let result = await db
    .collection("post")
    .updateOne(
      { _id: new ObjectId(req.body.id) },
      { $set: { title: req.body.title, content: req.body.content } }
    );
  console.log(result);
  res.redirect("/list");
});
// 좋아요 달기
//.updateOne({_id : },{$set : })  $set은 덮어쓴다. $inc는 기존값에 + or - , mul 곱하기 , unset 필드값 삭제(title, content)
// 동시에 여러개 수정할때는 .updateMany를 사용하면 id(첫번째{})가 일치하는 set부분(두번째 {}항 )을 다 바꿔줌.
// 여러 조건의 데이터 찾을때 ex) like가 10 이상인 항목을 모두 수정하려면?
//필터링 가능!

app.delete("/delete", async (req, res) => {
  let result = await db.collection("post").deleteOne({
    _id: new ObjectId(req.query.docid),
    user: new ObjectId(req.user._id), //삭제가 완료 됐을때만 HTML안보이게 UI 수정
  });
  console.log(result.deletedCount);
  res.send("삭제됨됨");
});

app.get("/list/:id", async (req, res) => {
  let result = await db
    .collection("post")
    .find()
    .skip((req.params.id - 1) * 5)
    .limit(5)
    .toArray();
  res.render("list.ejs", { listpost: result });
});

passport.use(
  new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
    let result = await db
      .collection("user")
      .findOne({ username: 입력한아이디 });
    if (!result) {
      return cb(null, false, { message: "아이디 DB에 없음" });
    }
    // await bcrypt.compare(입력한비번, result.password); //bool
    if (await bcrypt.compare(입력한비번, result.password)) {
      return cb(null, result); // 이부분의 result가 아래 user로 넘어감.
    } else {
      return cb(null, false, { message: "비번불일치" });
    }
  })
); //passreqest~~~

passport.serializeUser((user, done) => {
  //user 로그인 중인 유저정보
  //
  process.nextTick(() => {
    // 특정코드를 비동기적으로 사용. 비동기적으로 처리해줌
    done(
      null, // DB저장은 자동으로 비동기적 처리
      { id: user._id, username: user.username } // 추가로 유효기간을 설정해주지 않으면 2주
    );
  });
});

// @@@@ 비효율 적인 것, 세션정보 쿠키를 가지고 있는 유저가 요청 날릴때마다 실행됨
//특정 라우트(특정 API) 안에서만 실행가능하게 하는 방법.
//요청이 너무 많아서 DB조회가 많이 발생할거 같으면 Redis(가벼운 메모리기반 DB)사용? 세션만 보관. Connect Redis 검색
//여기까지가 세션방식!!!!!!! 다른방식은 JWT 방식이 있음 공부할것.

passport.deserializeUser(async (user, done) => {
  // 쿠키를 분석해주는 역할
  let result = await db
    .collection("user")
    .findOne({ _id: new ObjectId(user.id) });
  delete result.password;
  process.nextTick(() => {
    done(null, result); // 쿠키를 까서 비교함.   세션에 적힌 유저 정보를 그대로 req.user에 담아줌 오래되면 사실과 다름
  }); // 쿠키가 이상 없으면 현재 로그인 된 유저정보 알려줌
});

app.get("/login", async (req, res) => {
  res.render("login.ejs"); // req.user 로 현제 로그인된 유저의 정보 받아옴
});

app.post("/login", checkIdPw, (req, res, next) => {
  // 중복 회원가입, 비번 입력란을 2개만들어서 일치해야 가입.(자바스크립트로만 짜서 프론트에 해도 가능), 로그인한 유저만 글작성?
  passport.authenticate("local", (error, user, info) => {
    if (error) return res.status(500).json(error);
    if (!user) return res.status(500).json(info.message);
    req.logIn(user, (err) => {
      if (err) return next(err);
      res.redirect("/list");
    });
  })(req, res, next);
});

app.get("/mypage", (req, res) => {
  console.log(req.user);
  res.render("mypage.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.post("/register", checkIdPw, async (req, res) => {
  let hash = await bcrypt.hash(req.body.password, 15); // 문자는 그냥 암호화, 15는 어느정도 바꿀지 보통 10번정도 꼰다. 해싱1에 1초(50ms)정도 걸림
  await db.collection("user").insertOne({
    username: req.body.username,
    password: hash,
  });

  res.redirect("/login");
});
// bcrypt
// rainbow table attack , lookup table attack hash를 보고
//추론해서 맞추는 방법
//따라서 salt(랜덤한 문자)를 입력해서 hash를 꼬아주는 것
//salt 를 따로 DB나 하드에 보관할수도 있다 이방법을 pepper.

app.use("/shop", require("./routes/shop.js"));

app.get("/search", async (req, res) => {
  let searchCond = [
    {
      $search: {
        index: "title_index",
        text: { query: req.query.val, path: "title" },
      },
    },
    { $sort: { _id: 1 } }, // 날짜 ~~ ID~, -1역순 , (limit 절제, skip 건너뛰기)  페이지네이션
  ]; // $project : {_id : 0} id필드를 숨김
  let result = await db.collection("post").aggregate(searchCond).toArray(); // explain('executionStats') 쓸수 있음 검색 성능 비교해줌. collscan 이면 모든 도큐먼트 찾아본것.
  //{$regex : req.query.val} $regex는 정규식. document가 많을때 .find() 느림. 모든 도큐먼트를 까서 비교하기떄문.
  //index라는것을 쓰면 검색기능 향상. collection을 복사해서 미리 정렬해준것.검색이 필요한 필드만 인덱스 만들기. 인덱스를 만들때 용량을 차지함.
  //index를 텍스트 기준으로 만들면 띄어쓰기 기준 분석. 정규식을쓰면 index를 못씀 영어는 가능. 한글은 어려움. 문자말고 숫자 검색할때 index 만들기.
  console.log(result);
  res.render("search.ejs", { posts: result });
}); //바이너리서치. Btree

app.post("/comment", async (req, res) => {
  await db.collection("comment").insertOne({
    content: req.body.content,
    writerId: new ObjectId(req.user._id),
    writer: req.user.username,
    parentId: new ObjectId(req.body.parentId),
  });
  res.redirect("back"); // AjAX 문법으로 부드러운 UI로 바꾸기???
});

// app.use(express.static(path.join(__dirname, 'react-project/build')));

// app.get('/', function (요청, 응답) {
//   응답.sendFile(path.join(__dirname, '/react-project/build/index.html'));
// });
// node.js express 와 React 연동하기!!!!!!!!!!!!!!!!!!!!

//server sent events 서버가 원할떄 유저에게 데이터 전송가능
//유저에게 전송만 가능 ex)radio SSE사용하려면 HTTP요청하고 서버가 SSE로 업글해줘야함
//websocket또한 유저가 HTTP요청을 하면 Websocket으로 업글해야줘야함 평소에는 HTTP요청을 받아서 SSE나 WS로 업글하는방식 채용용
//서버에서 계속 유저에게 PUSH 해주려면 SSE 실시간 서버-유저 양방통신일때는 WebSocket하기.

app.get("/chat/request", async (req, res) => {
  await db.collection("chatroom").insertOne({
    member: [req.user._id, new ObjectId(req.query.writerId)],
    date: new Date(),
  });

  // 채팅 누르면 계속 새로운 채팅방생김. 기존 채팅방으로 운영하기.
  res.redirect("/chat/list");
});

app.get("/chat/list", async (req, res) => {
  let result = await db
    .collection("chatroom")
    .find({
      member: req.user._id,
    })
    .toArray();

  res.render("chatList.ejs", { result: result });
});

app.get("/chat/detail/:id", async (req, res) => {
  let result = await db
    .collection("chatroom")
    .findOne({ _id: new ObjectId(req.params.id) });
  res.render("chatDetail.ejs", { result: result });
});

io.on("connection", (socket) => {
  console.log("socket connect");
  
  socket.on("age", (data) => {
    io.emit("", ""); // 모든유저
  });

  socket.on("ask-join", (data) => {
   // socket.request.session     
    socket.join(data); 
    console.log('user join : '+ data);
  });
  socket.on('message-send', (data) => {

    //db에 저장하는 로직. 채팅내용 시간 부모 document id 작성자

    //DBadapter
     io.to(data.room).emit("message-broadcast", data.msg);
  });
});

//SSE 
// 실시간으로 새로운 게시물을 계속 쏴줌. DB에 추가되는 새로운 게시물을 서버가 가져오는 방법?
//MongoDB change stream쓰면 DB변동사항 실시간으로로 받음

app.get('/stream/list',(req,res)=>{

  res.writeHead(200, {
    "Connection" : "keep-alive",
    "Content-Type" : "text/event-stream",
    "Cache-Control" : "no-cache"
  })

  // setInterval(()=>{ 1초마다 {} 안 코드 실행
  // }, 1000)
  
  changeStream.on('change', (result)=>{   //변동내용을 result담음 CRUD 내용
  console.log( result)
  res.write('event: newPost\n')
  res.write(`data: ${JSON.stringify(result.fullDocument)}\n\n`)
 
})

})

//mongoose 장점 데이터가 정확한지 검사해줌 단점 2배이상 느려짐.
//type hint? 변수에 담긴 타입들, 어떤 타입 데이터가 들어있는지? typescript 사용 . 쓰려면세팅을 다시해야함.
//타입스크립트쓰면 장점은 타입이 부여된 것 자동완성도 좋고 타입을 지정.
//  JSDoc.  /** @type{{title : string, content : string}} */  TS 안쓰고 JS 파일에선 이런 방식으로 타입 힌트를 줄수 있다. 귀찮고 더러워질수 있음
//data validation 데이터 검증 하려면 if문. or express-validator /ajv 등등.
//DB에 들어가는 데이터를 엄격하게 검증?? mongoDB에는 schema validation 기능이 있다. DB단에서 막는방법
// 다른 프레임워크로 빠른거 fastify 
//Spring 처럼 짜려면 Nest.js 어노테이션 쓰는듯 내부적으로 express 쓰는데 코드를 분리하고 재사용하기 위해 만든 프레임워크,
// react 와 CSR 많이 넣으려면 Next.js
// 대량의 트래픽이 들어오는데 웹페이지를 빠르게 보내주고싶으면 캐싱, CDN, 쿼리성능 개선 을 먼저. 서버성능은 후에.
// 포폴만들때는 자동로그인되게 하고 사이트에 있는 기능 영상이나 gif 찍어서 설명하기.
// swagger 같은 내가만든 API 요약본 정리.  DB의 컬렉션과 document 구조를 ERD처럼 그려놔도 좋음.
//API가 많아지면 routes 파일 만들어서 비슷한 API끼리 파일에 모아놓거나 API안에 있는 코드가 너무 길면 함수로 빼고 비슷한 기능을 하는 함수정의들을 한파일에 모아놓기.
// db에 document 데이터가 많아져도 CRUD가 편리할지. 에러나 예외사항이 발생해도 대처 가능한지. 코드가 길어져도 찾아서 수정이 편리할지 생각해서 짜기.
// 결제기능은 포트원이라는 서비스쓰기. 에디터?유저가 작성한글을 HTML이나 JSON으로 변화해서 DB에 저장할수 있게 해줌 quill.js ToastUI
