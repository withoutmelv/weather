const Koa = require('koa');
const views = require('koa-views');
const path = require('path');
// 路由处理
const Router = require('koa-router');
const router = new Router();
const fs = require('fs').promises;
const dayjs = require('dayjs');
const serve = require('koa-static'); // 引入静态文件服务中间件
const {imageDataPath, staticResourcePath} = require('./config');
const app = new Koa();

const MODEL_LIST = process.env.MODEL_LIST.split(',');
const DEFAULT_MODEL = process.env.DEFAULT_MODEL;
const IMAGE_NAME = process.env.IMAGE_NAME;



// 配置静态文件目录（假设静态文件在public目录下）
app.use(serve(path.join(staticResourcePath)));
// 配置模板引擎
app.use(views(path.join(__dirname, 'views'), {
  extension: 'ejs'
}));

// 默认路由 (显示最新时间的图片)
router.get('/', async (ctx) => {
  const defaultModel = DEFAULT_MODEL;
  const reportHourList = process.env.REPORT_HOUR_LIST.split(',');
  const forcastAmHourList = process.env.FORCAST_AM_HOUR_LIST.split(',');
  const forcastPmHourList = process.env.FORCAST_PM_HOUR_LIST.split(',');
  const forcastHourList = {};
  forcastHourList[reportHourList[0]] = forcastAmHourList;
  forcastHourList[reportHourList[1]] = forcastPmHourList;

  const currentHour = new Date().getHours();
  const currentReportTime = dayjs(process.env.START_DATE).hour(currentHour >= 12 ? 12 : 0).minute(0).format('YYYY-MM-DD HH:mm');


  function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  }

  await ctx.render('index', {
    modelList: MODEL_LIST,
    defaultModel,
    reportHourList,
    forcastHourList,
    currentReportTime,
    startDate: process.env.START_DATE,
    formatDate,
  });
});


// 添加图片请求处理路由
router.get('/:reportDate/:forcastDate', async (ctx) => {
  const { reportDate, forcastDate } = ctx.params;
  const imagePath = path.join(imageDataPath, reportDate, forcastDate, IMAGE_NAME);
  const dirPath = path.join(imageDataPath, reportDate, forcastDate); // 添加目录路径
  try {
    // 先检查目录是否存在
    await fs.access(dirPath, fs.constants.F_OK);
    
    // 目录存在，读取目录内容
    const files = await fs.readdir(dirPath);
    
    if (files.length === 0) {
      // 目录存在但无文件 - 模型预测中
      ctx.status = 202;
      ctx.body = { status: '数据预测中' };
      return;
    }
    // 目录存在且有文件，继续检查目标文件
    await fs.access(imagePath);
    // 文件存在，返回图片
    try {
      const data = await fs.readFile(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const contentType = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif'
      }[ext] || 'application/octet-stream';

      ctx.set('Content-Type', contentType);
      ctx.body = data;
    } catch (err) {
      console.error('读取文件失败:', err);
      ctx.status = 500;
      ctx.body = { status: '文件读取失败' };
    }
  } catch (err) {
    // 目录不存在 - 无数据
    ctx.status = 404;
    ctx.body = { status: '无数据' };
  }
});

// 应用路由
app.use(router.routes()).use(router.allowedMethods());
// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
