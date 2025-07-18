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
const axios = require('axios');
const winston = require('winston');
const {imageDataPath, staticResourcePath} = require('./config');


const app = new Koa();
const MODEL_LIST = process.env.MODEL_LIST.split(',');
const DEFAULT_MODEL = process.env.DEFAULT_MODEL;
const IMAGE_NAME = process.env.IMAGE_NAME;
const INPUT_DIR = process.env.INPUT_DIR;
const OUTPUT_DIR = process.env.OUTPUT_DIR;
const START_DATE = process.env.START_DATE || dayjs().format('YYYY-MM-DD');
const TIME_LEN = process.env.TIME_LEN;
const TIME_GAP = process.env.TIME_GAP;
const LOG_PATH = process.env.LOG_PATH;


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


function getPredictTime(reportDate) {
  const reportHour = dayjs(reportDate).hour();
  const hourList = [];
  if (reportHour >= 12) {
    for (let i =1; i <=TIME_LEN; i++) {
      hourList.push(dayjs(reportDate).add(i * TIME_GAP, 'hour').format('MMDDHH00'));
    }
  } else {
    for (let i =1; i <=TIME_LEN; i++) {
      hourList.push(dayjs(reportDate).add(i * TIME_GAP, 'hour').format('MMDDHH00'));
    }
  }
  logger.info(`hourLoist: ${hourList}`)
  return hourList;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

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

// 默认路由 (显示最新时间的图片)
router.get('/', async (ctx) => {
  logger.info('首页请求 - 用户访问主页');
  const defaultModel = DEFAULT_MODEL;
  const reportHourList = process.env.REPORT_HOUR_LIST.split(',');
  const forcastAmHourList = process.env.FORCAST_AM_HOUR_LIST.split(',');
  const forcastPmHourList = process.env.FORCAST_PM_HOUR_LIST.split(',');
  const forcastHourList = {};
  forcastHourList[reportHourList[0]] = forcastAmHourList;
  forcastHourList[reportHourList[1]] = forcastPmHourList;

  const currentHour = new Date().getHours();
  const currentReportTime = dayjs(START_DATE).hour(currentHour >= 12 ? 12 : 0).minute(0).format('YYYY-MM-DD HH:mm');

  await ctx.render('index', {
    modelList: MODEL_LIST,
    defaultModel,
    reportHourList,
    forcastHourList,
    currentReportTime,
    startDate: START_DATE,
    formatDate,
  });
});


// 添加图片请求处理路由
router.get('/:reportDate/:forcastDate', async (ctx) => {
  const { reportDate, forcastDate } = ctx.params;
  logger.info(`图片请求 - reportDate: ${reportDate}, forcastDate: ${forcastDate}`);
  const imagePath = path.join(imageDataPath, reportDate, dayjs(forcastDate).format('YYYYMMDDHHmm'), IMAGE_NAME);
  const dirPath = path.join(imageDataPath, reportDate, dayjs(forcastDate).format('YYYYMMDDHHmm'));
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
      }
      
      // 目录存在但目标文件不存在
      ctx.status = 404;
      ctx.body = { status: '图片不存在' };
    } catch (err) {
      const ECpath = path.join(__dirname, INPUT_DIR, year, dateStr);
      logger.info(`EC目录路径: ${ECpath}`);
      
      try {
        let ECFiles = await fs.readdir(ECpath);
        logger.info(`EC目录内容: ${ECFiles.join(', ')}`);
        
        ECFiles = ECFiles.filter(f => {
          const report2ForcastDate = (f.split('C1D')[1]).split('.')[0];
          const predictTimeList = getPredictTime(reportDate);
          return report2ForcastDate.slice(0, 8) === dayjs(reportDate).format('MMDDHH00') && predictTimeList.includes(report2ForcastDate.slice(8, 16));
        }).map(f => path.join(ECpath, f));
        
        logger.info(`筛选后的EC文件: ${ECFiles.join(', ')}`);
        if (ECFiles.length === 0) {
          ctx.status = 404;
          ctx.body = { status: '原始数据获取失败' };
          return;
        }
        logger.info(`API 请求 - 数据路径: ${JSON.stringify({
          data_paths: ECFiles,
          data_type: "EC",
          output_dir: OUTPUT_DIR
        })}`);
        
        let localIP = getLocalIP();
        logger.info(`API 请求 - 本地IP: ${localIP} 端口: ${process.env.API_PORT}`);
        
        axios.post(`http://${process.env.API_HOST || localIP}:${process.env.API_PORT}${process.env.API_URL}`, {
          data_paths: ECFiles,
          data_type: "EC",
          output_dir: OUTPUT_DIR
        }).then(res => {
          logger.info(`API 请求成功: ${res}`);
        }).catch(err => {
          logger.error('API 请求失败:', err);
        });
        
        // 目录不存在 - 触发预测流程
        ctx.status = 202;
        ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate'); // 禁止缓存未完成的请求
        ctx.body = { status: '数据预测中' };
      } catch(err) {
        logger.error(`原始数据处理失败: ${err.message}`);
        // 目录不存在 - 无数据
        ctx.status = 404;
        ctx.body = { status: '原始数据获取失败' };
      }
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
