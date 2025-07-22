const Koa = require('koa');
const views = require('koa-views');
const path = require('path');
// 路由处理
const Router = require('koa-router');
const router = new Router();
const fs = require('fs').promises;
const dayjs = require('dayjs');
const serve = require('koa-static'); // 引入静态文件服务中间件
const os = require('os');
const winston = require('winston');
const {imageDataPath, staticResourcePath} = require('./config');


const app = new Koa();
const MODEL_LIST = process.env.MODEL_LIST.split(',');
const DEFAULT_MODEL = process.env.DEFAULT_MODEL;
const IMAGE_NAME = process.env.IMAGE_NAME;
const LOG_PATH = process.env.LOG_PATH;
const TIME_LEN = process.env.TIME_LEN;
const TIME_GAP = process.env.TIME_GAP;
const basePath = process.env.BASE_PATH;

const IMAGEMAP = {
  'EC': '',
  'CMA': 'CMA',
}


// 确保日志目录存在
const logDir = path.join(__dirname, LOG_PATH);
if (!fs.access(logDir)) {
  fs.mkdir(logDir);
}

// 配置winston日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
      )
    }),
    // 文件输出 - 所有日志
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // 文件输出 - 错误日志
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});


// 配置静态文件目录（假设静态文件在public目录下）
app.use(serve(path.join(staticResourcePath)));
// 配置模板引擎
app.use(views(path.join(__dirname, 'views'), {
  extension: 'ejs'
}));

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (const alias of iface) {
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1'; // 默认返回本地回环地址
};

function generateHourList(date, reportHourList) {
  const forcastAmHourList = [];
  const forcastPmHourList = [];
  const currentAmDate = dayjs(date).hour(0).minute(0).format('YYYY-MM-DD HH:mm');
  const currentPmDate = dayjs(date).hour(12).minute(0).format('YYYY-MM-DD HH:mm');
  for(let i = 1; i <= TIME_LEN; i++) {
    forcastAmHourList.push(dayjs(currentAmDate).add(i * TIME_GAP, 'hour').format('YYYY-MM-DD HH:mm'));
    forcastPmHourList.push(dayjs(currentPmDate).add(i * TIME_GAP, 'hour').format('YYYY-MM-DD HH:mm'));
  }

  const forcastHourList = {};
  forcastHourList[reportHourList[0]] = forcastAmHourList;
  forcastHourList[reportHourList[1]] = forcastPmHourList;
  return forcastHourList;

}

router.get('/', async (ctx) => {
  ctx.redirect(basePath);
})

// 默认路由 (显示最新时间的图片)
router.get(basePath, async (ctx) => {
  logger.info('首页请求 - 用户访问主页');
  let START_DATE = process.env.START_DATE || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const defaultModel = DEFAULT_MODEL;
  const ECReportHourList = process.env.EC_REPORT_HOUR_LIST.split(',');
  const CMAReportHourList = process.env.CMA_REPORT_HOUR_LIST.split(',');

  let currentHour = new Date().getHours();
  let currentReportTime = dayjs(START_DATE).hour(currentHour >= 12 ? 12 : 0).minute(0).format('YYYY-MM-DD HH:mm');
  const dirPath = path.join(imageDataPath+IMAGEMAP[defaultModel]);

  try {
    const dirList = await fs.readdir(dirPath);
    logger.info(`目录列表: ${dirList}`);
    dirList.sort((a, b) => dayjs(a).isBefore(dayjs(b)) ? 1 : -1);
    logger.info(`目录列表: ${dirList}`);
    if (!dirList.length) {throw new Error('目录列表为空')}
    currentHour = dayjs(dirList[0]).hour();
    currentReportTime = dayjs(dirList[0]).format('YYYY-MM-DD HH:mm');
    START_DATE = dayjs(dirList[0]).format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD');
  } catch (err) {
    logger.error(`读取目录失败: ${dirPath}`);
    START_DATE = dayjs().format('YYYY-MM-DD');
    currentHour = new Date().getHours();
    currentReportTime = dayjs(START_DATE).hour(currentHour >= 12 ? 12 : 0).minute(0).format('YYYY-MM-DD HH:mm');
  }
  const reportHourList = defaultModel === 'EC' ? ECReportHourList : CMAReportHourList
  const forcastHourList = generateHourList(START_DATE, reportHourList);
  console.log(forcastHourList)

  await ctx.render('index', {
    modelList: MODEL_LIST,
    defaultModel,
    ECReportHourList,
    CMAReportHourList,
    reportHourList,
    forcastHourList,
    currentReportTime,
    startDate: START_DATE,
    TIME_GAP,
    TIME_LEN,
    basePath,
  });
});

// 添加图片请求处理路由
router.get(basePath+'/picture/:model/:reportDate/:forcastDate', async (ctx) => { 
  const { model, reportDate, forcastDate } = ctx.params;
  logger.info(`图片请求 - model: ${model}, reportDate: ${reportDate}, forcastDate: ${forcastDate}`);
  const imagePath = path.join(imageDataPath + IMAGEMAP[model], reportDate, dayjs(forcastDate).format('YYYYMMDDHHmm'), IMAGE_NAME);
  const dirPath = path.join(imageDataPath + IMAGEMAP[model], reportDate, dayjs(forcastDate).format('YYYYMMDDHHmm'));
  const year = dayjs(reportDate).year() + '';
  const dateStr = dayjs(reportDate).format('YYYYMMDD');
  
  try {
    // 检查文件是否存在并获取状态
    const stats = await fs.stat(imagePath);
    
    // 设置缓存控制头
    ctx.set('Cache-Control', 'public, max-age=3600'); // 缓存1小时
    ctx.set('ETag', stats.mtime.getTime().toString()); // 使用文件修改时间作为ETag
    
    // 检查客户端缓存
    if (ctx.request.headers['if-none-match'] === stats.mtime.getTime().toString()) {
      ctx.status = 304; // 资源未修改
      return;
    }
    
    // 文件存在，返回图片
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
    logger.info(`图片资源不存在: ${reportDate} ${forcastDate} ${JSON.stringify({
      reportDate,
      forcastDate,
      imagePath,
      dirPath,
      year,
      dateStr,
    })}`, err);
    // 文件不存在或其他错误
    try {
      // 检查目录是否存在
      await fs.access(dirPath, fs.constants.F_OK);
      logger.info(`目录存在: ${dirPath}`);
      
      // 目录存在，读取目录内容
      const files = await fs.readdir(dirPath);
      logger.info(`目录内容: ${files.join(', ')}`);
      
      if (files.length === 0) {
        // 目录存在但无文件 - 模型预测中
        ctx.status = 202;
        ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate'); // 禁止缓存未完成的请求
        ctx.body = { status: '数据预测中' };
        return;
      } else if (!files.includes(IMAGE_NAME)) {
        // 目录存在但目标文件不存在
        ctx.status = 404;
        ctx.body = { status: '图片不存在' };
        return;
      }
    } catch (err) {
      logger.error(`目录不存在: ${dirPath} ${JSON.stringify({
        reportDate,
        forcastDate,
        imagePath,
        dirPath,
        year,
        dateStr,
      })}`, err);
    }
  }
});

// 应用路由
app.use(router.routes()).use(router.allowedMethods());

// 启动服务器
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  let localIP = getLocalIP();
  logger.info(`服务器启动成功 - http://${localIP}:${PORT}`);
});
