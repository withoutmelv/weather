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
const schedule = require('node-schedule');
const {imageDataPath, staticResourcePath} = require('./config');


const app = new Koa();
const MODEL_LIST = process.env.MODEL_LIST.split(',');
const DEFAULT_MODEL = process.env.DEFAULT_MODEL;
const IMAGE_NAME = process.env.IMAGE_NAME;
const INPUT_DIR = process.env.INPUT_DIR;
const OUTPUT_DIR = process.env.OUTPUT_DIR;
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
  console.log(reportHour, reportDate)
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

router.get('/', async (ctx) => {
  ctx.redirect('/cloudPredict');
})

router.get('/index', async (ctx) => {
  ctx.redirect('/cloudPredict');
})

// 默认路由 (显示最新时间的图片)
router.get('/cloudPredict', async (ctx) => {
  logger.info('首页请求 - 用户访问主页');
  const START_DATE = process.env.START_DATE || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
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

// 根据当前时间 扫描output_image文件夹下缺失的近一个月的目录，并根据缺失的
const scanMissingDir = async () => {
  const currentDate = dayjs();
  // 从一个月前的00:00开始，确保起始时间为整点
  const startDate = currentDate.subtract(3, 'day').startOf('day').format('YYYYMMDDHHmm');
  // 结束时间为当前日期的23:59，确保覆盖当天可能的12:00
  const endDate = currentDate.endOf('day').format('YYYYMMDDHHmm');

  const missingDirList = [];
  // 使用dayjs对象进行日期比较，避免字符串比较问题
  let current = dayjs(startDate, 'YYYYMMDDHHmm');
  const end = dayjs(endDate, 'YYYYMMDDHHmm');

  while (current.isBefore(end) || current.isSame(end)) {
    // 只处理00点和12点的目录
    const hour = current.hour();
    if (hour === 0 || hour === 12) {
      const dateStr = current.format('YYYYMMDDHHmm');
      const dirPath = path.join(imageDataPath, dateStr);
      try {
        await fs.access(dirPath, fs.constants.F_OK);
      } catch (err) {
        missingDirList.push(dateStr);
      }
    }
    // 每次增加12小时
    current = current.add(12, 'hour');
  }

  logger.info(`缺失目录列表: ${missingDirList}`);

  // missingDirList日期排序
  missingDirList.sort((a, b) => dayjs(a).isBefore(dayjs(b)) ? 1 : -1);

  // 根据缺失目录调用API接口
  for (let reportDate of missingDirList) {
    console.log('reportDate', reportDate)
    try {
      const year = dayjs(reportDate).year() + '';
      const reportDateStr = dayjs(reportDate).format('YYYYMMDD');
      const hour = dayjs(reportDate).hour();
      let predictTimeList = []
      let scanStr = reportDateStr;
      if (hour == 12) {
        scanStr += '1200';
        predictTimeList = getPredictTime(reportDateStr + '1200');
      }
      else {
        scanStr += '0000';
        predictTimeList = getPredictTime(reportDateStr + '0000');
      }
        
      
      // 构造EC文件路径
      const ECpath = path.join(__dirname, INPUT_DIR, year, reportDateStr);
      logger.info(`EC目录路径: ${ECpath}`);
      logger.info(scanStr.slice(4))
      // 读取并筛选EC文件
      let ECFiles = await fs.readdir(ECpath);
      // const predictTimeList = getPredictTime(dateStr);
      ECFiles = ECFiles.filter(f => {
        const report2ForcastDate = (f.split('C1D')[1]).split('.')[0];
        
        return report2ForcastDate.slice(0, 8) === scanStr.slice(4) && 
               predictTimeList.includes(report2ForcastDate.slice(8, 16));
      }).map(f => path.join(ECpath, f));
      
      if (ECFiles.length === 0) {
        logger.warn(`没有找到符合条件的EC文件: ${ECpath}`);
        continue;
      }
      
      // 调用API接口
      const localIP = getLocalIP();
      logger.info(`API 请求 - 本地IP: ${localIP} 端口: ${process.env.API_PORT}`);
      try {
        await axios.post(`http://${process.env.API_HOST || localIP}:${process.env.API_PORT}${process.env.API_URL}`, {
          data_paths: ECFiles,
          data_type: "EC",
          output_dir: OUTPUT_DIR
        });
      } catch(e) {
        logger.error(`API 请求失败: ${reportDateStr} ${JSON.stringify({
          data_paths: ECFiles,
          data_type: "EC",
          output_dir: OUTPUT_DIR
        })}`, `${JSON.stringify(e)}`);
      }
    } catch (err) {
      logger.error(`处理缺失目录时出错:`, err);
    }
  }
};

// 添加图片请求处理路由
router.get('/picture/:reportDate/:forcastDate', async (ctx) => {
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
      // const ECpath = path.join(__dirname, INPUT_DIR, year, dateStr);
      // logger.info(`EC目录路径: ${ECpath}`);
      
      // try {
      //   let ECFiles = await fs.readdir(ECpath);
      //   const predictTimeList = getPredictTime(reportDate);
      //   ECFiles = ECFiles.filter(f => {
      //     const report2ForcastDate = (f.split('C1D')[1]).split('.')[0];
          
      //     return report2ForcastDate.slice(0, 8) === dayjs(reportDate).format('MMDDHH00') && predictTimeList.includes(report2ForcastDate.slice(8, 16));
      //   }).map(f => path.join(ECpath, f));
        
      //   logger.info(`筛选后的EC文件: ${ECFiles.join(', ')}`);
      //   if (ECFiles.length === 0) {
      //     ctx.status = 404;
      //     ctx.body = { status: '原始数据获取失败' };
      //     return;
      //   }
      //   logger.info(`API 请求 - 数据路径: ${JSON.stringify({
      //     data_paths: ECFiles,
      //     data_type: "EC",
      //     output_dir: OUTPUT_DIR
      //   })}`);
        
      //   let localIP = getLocalIP();
      //   logger.info(`API 请求 - 本地IP: ${localIP} 端口: ${process.env.API_PORT}`);
        
      //   axios.post(`http://${process.env.API_HOST || localIP}:${process.env.API_PORT}${process.env.API_URL}`, {
      //     data_paths: ECFiles,
      //     data_type: "EC",
      //     output_dir: OUTPUT_DIR
      //   }).then(res => {
      //     logger.info(`API 请求成功: ${JSON.stringify(res)}`);

      //   }).catch(err => {
      //     logger.error(`API 请求失败: ${JSON.stringify({
      //       data_paths: ECFiles,
      //       data_type: "EC",
      //       output_dir: OUTPUT_DIR
      //     })}`,`${JSON.stringify(res)}`, err);
      //   });
        
      //   // 目录不存在 - 触发预测流程
      //   ctx.status = 202;
      //   ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate'); // 禁止缓存未完成的请求
      //   ctx.body = { status: '数据预测中' };
      // } catch(err) {
      //   logger.error(`原始数据处理失败: ${err.message}`);
      //   // 目录不存在 - 无数据
      //   ctx.status = 404;
      //   ctx.body = { status: '原始数据获取失败' };
      // }
    }
  }
});

// 应用路由
app.use(router.routes()).use(router.allowedMethods());

try {
  scanMissingDir();
} catch (err) {
  logger.error("scanMissingDir error:", err);
}
schedule.scheduleJob('* * * * *', async () => {  
  try {
    logger.info('定时扫描任务开始执行');
    await scanMissingDir();
    logger.info('定时扫描任务执行完成');
  } catch (error) {
    logger.error('定时扫描任务执行失败:', error);
  }
});
// 启动服务器
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  let localIP = getLocalIP();
  logger.info(`服务器启动成功 - http://${localIP}:${PORT}`);
});
