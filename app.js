const Koa = require('koa');
const views = require('koa-views');
const path = require('path');
// 路由处理
const Router = require('koa-router');
const router = new Router();
const fs = require('fs').promises;
const dayjs = require('dayjs');
const serve = require('koa-static'); // 引入静态文件服务中间件
const {imageDataPath, staticResourcePath,} = require('./config');
const app = new Koa();

const MAX_AGE = process.env.MAX_AGE;
const BLOCK_LEN = process.env.BLOCK_LEN;
const MODEL_LIST = process.env.MODEL_LIST.split(',');
const IMAGE_PATH = process.env.IMAGE_PATH;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL;
const IMAGE_NAME = process.env.IMAGE_NAME;


// 配置静态文件目录（假设静态文件在public目录下）
app.use(serve(path.join(staticResourcePath)));
// 配置模板引擎
app.use(views(path.join(__dirname, 'views'), {
  extension: 'ejs'
}));

// 获取所有时间列表的函数
const getReportTimeList = async () => {
  const timeList = new Set();
  const sampleDir = path.join(imageDataPath);

  try {
    const folders = await fs.readdir(sampleDir, { withFileTypes: true });
    for (const folder of folders.filter(d => d.isDirectory())) {
      const match = folder.name.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [_, year, month, day, hour, minute] = match;
        const date = `${year}-${month}-${day} ${hour}:${minute}`;
        timeList.add(date);
      }
    }
  } catch (err) {
    console.error('读取时间列表失败:', err);
  }
  return [...timeList]
};

const getForcastReportMap = async (dateList) => {
  let reportTimeList = {};
  for (let j = 0; j < dateList.length; j++) {
    const reportPoint = dateList[j];
    reportTimeList[reportPoint] = {}
    const paths = path.join(imageDataPath, dayjs(reportPoint).format('YYYYMMDDHHmm'));
    try {
      const files = await fs.readdir(paths);
      files.forEach((f) => {
        let forcastPoint = dayjs(f.split('.')[0]).format('YYYY-MM-DD HH:mm');
        reportTimeList[reportPoint][forcastPoint] = path.join(IMAGE_PATH, dayjs(reportPoint).format('YYYYMMDDHHmm'), f);
      })
    } catch(err) {
      console.error('获取预测时间失败:', err);
      continue;
    }
  }
  return reportTimeList
};

// 默认路由 (显示最新时间的图片)
router.get('/', async (ctx) => {
  const reportTimeList = await getReportTimeList();
  const reportForcastMap = await getForcastReportMap(reportTimeList);
  const defaultReportTime = reportTimeList[0]
  const defaultModel = DEFAULT_MODEL;
  console.log(reportForcastMap);
  await ctx.render('index', {
    modelList: MODEL_LIST,
    reportTimeList,
    reportForcastMap,
    defaultReportTime,
    defaultModel,
  });
});

// 应用路由
app.use(router.routes()).use(router.allowedMethods());
// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});