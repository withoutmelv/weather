const Koa = require('koa');
const views = require('koa-views');
const path = require('path');
// 路由处理
const Router = require('koa-router');
const router = new Router();
const fs = require('fs');
const fsp = fs.promises;
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
const TITLE_STORE_PATH = process.env.TITLE_STORE_PATH || 'data/title-overrides.json';
const titleStorePath = path.resolve(__dirname, TITLE_STORE_PATH);
const TITLE_MAX_LENGTH = 120;
const DEFAULT_MAP_TYPE = 'legacy';
const DEFAULT_HOME_MAP_TYPE = process.env.DEFAULT_HOME_MAP_TYPE || 'china';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output_image';

const IMAGEMAP = {
  'EC': '',
  'CMA': 'CMA',
}

function resolveOutputPath(outputPath) {
  return path.resolve(__dirname, outputPath);
}

const IMAGE_PRODUCTS = {
  legacy: {
    layout: 'legacy',
    dirs: {
      EC: imageDataPath,
      CMA: resolveOutputPath(process.env.CMA_OUTPUT_DIR || `${OUTPUT_DIR}${IMAGEMAP.CMA}`),
    },
  },
  china: {
    layout: 'china',
    dirs: {
      EC: resolveOutputPath(process.env.CHINA_OUTPUT_DIR || 'output_china_image'),
      CMA: resolveOutputPath(process.env.CHINA_CMA_OUTPUT_DIR || 'output_china_imageCMA'),
    },
  },
}

function isSafeImageFileName(fileName) {
  return !fileName || /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|gif)$/i.test(fileName);
}


// 确保日志目录存在
const logDir = path.join(__dirname, LOG_PATH);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
// 确保标题存储文件存在
if (!fs.existsSync(titleStorePath)) {
  const dataDir = path.dirname(titleStorePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(titleStorePath, '{}');
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

function getFallbackReportTime(date) {
  const fallbackDate = date || dayjs().format('YYYY-MM-DD');
  const currentHour = new Date().getHours();
  return dayjs(fallbackDate).hour(currentHour >= 12 ? 12 : 0).minute(0).format('YYYY-MM-DD HH:mm');
}

function isValidMapType(mapType) {
  return Object.prototype.hasOwnProperty.call(IMAGE_PRODUCTS, mapType);
}

function getRequestMapType(ctx, fallbackMapType = DEFAULT_MAP_TYPE) {
  const mapType = ctx.query.mapType || fallbackMapType;
  return typeof mapType === 'string' && isValidMapType(mapType) ? mapType : null;
}

function getImageProduct(mapType) {
  return isValidMapType(mapType) ? IMAGE_PRODUCTS[mapType] : null;
}

function getModelImageDir(mapType, model) {
  const product = getImageProduct(mapType);
  return product?.dirs?.[model] || null;
}

async function getLatestReportTime(model, mapType = DEFAULT_MAP_TYPE) {
  const dirPath = getModelImageDir(mapType, model);
  if (!dirPath) {
    return null;
  }

  try {
    const dirList = await fsp.readdir(dirPath);
    const reportDirList = dirList.filter((dirName) => isCompactTimestamp(dirName));
    reportDirList.sort((a, b) => a < b ? 1 : -1);
    if (!reportDirList.length) {
      throw new Error('目录列表为空');
    }
    logger.info(`${mapType}/${model} 最新目录: ${reportDirList[0]}`);
    return dayjs(reportDirList[0]).format('YYYY-MM-DD HH:mm');
  } catch (err) {
    logger.error(`读取${mapType}/${model}目录失败: ${dirPath}`);
    return null;
  }
}

function isValidModel(model) {
  return MODEL_LIST.includes(model) && Object.prototype.hasOwnProperty.call(IMAGEMAP, model);
}

function isCompactTimestamp(value) {
  const text = String(value);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute;
}

function validateImageRouteParams(mapType, model, reportDate, forcastDate) {
  return isValidMapType(mapType)
    && isValidModel(model)
    && Boolean(getModelImageDir(mapType, model))
    && isCompactTimestamp(reportDate)
    && isCompactTimestamp(forcastDate);
}

function getTitleKey(mapType, model, reportDate, forcastDate) {
  return `${mapType}/${model}/${reportDate}/${forcastDate}`;
}

function getLegacyTitleKey(model, reportDate, forcastDate) {
  return `${model}/${reportDate}/${forcastDate}`;
}

async function readTitleStore() {
  try {
    const content = await fsp.readFile(titleStorePath, 'utf8');
    const store = JSON.parse(content);
    return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    logger.error(`读取标题配置失败: ${titleStorePath} ${err.message}`);
    throw err;
  }
}

async function writeTitleStore(store) {
  await fsp.mkdir(path.dirname(titleStorePath), { recursive: true });
  await fsp.writeFile(titleStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function readRequestText(ctx, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    ctx.req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('请求体过大'));
        ctx.req.destroy();
        return;
      }
      body += chunk;
    });
    ctx.req.on('end', () => resolve(body));
    ctx.req.on('error', reject);
  });
}

async function readJsonBody(ctx) {
  const body = await readRequestText(ctx, 1024 * 1024);
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

router.get('/', async (ctx) => {
  ctx.redirect(basePath);
})

// 默认路由 (显示最新时间的图片)
router.get(basePath, async (ctx) => {
  logger.info('首页请求 - 用户访问主页');
  const mapType = getRequestMapType(ctx, DEFAULT_HOME_MAP_TYPE);
  if (!mapType) {
    ctx.status = 400;
    ctx.body = { status: '地图版本不存在' };
    return;
  }
  let START_DATE = process.env.START_DATE || dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const defaultModel = DEFAULT_MODEL;
  const ECReportHourList = process.env.EC_REPORT_HOUR_LIST.split(',');
  const CMAReportHourList = process.env.CMA_REPORT_HOUR_LIST.split(',');

  let currentReportTime = getFallbackReportTime(START_DATE);

  const latestReportTime = await getLatestReportTime(defaultModel, mapType);
  if (latestReportTime) {
    currentReportTime = latestReportTime;
    START_DATE = dayjs(latestReportTime).format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD');
  } else {
    START_DATE = dayjs().format('YYYY-MM-DD');
    currentReportTime = getFallbackReportTime(START_DATE);
  }
  const reportHourList = defaultModel === 'EC' ? ECReportHourList : CMAReportHourList
  const forcastHourList = generateHourList(START_DATE, reportHourList);

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
    activeMapType: mapType,
  });
});

router.get(basePath+'/latest/:model', async (ctx) => {
  const { model } = ctx.params;
  const mapType = getRequestMapType(ctx);
  if (!mapType) {
    ctx.status = 400;
    ctx.body = { status: '地图版本不存在' };
    return;
  }
  if (!isValidModel(model)) {
    ctx.status = 400;
    ctx.body = { status: '模型不存在' };
    return;
  }

  const latestReportTime = await getLatestReportTime(model, mapType);
  const currentReportTime = latestReportTime || getFallbackReportTime();

  ctx.body = {
    mapType,
    model,
    currentReportTime,
    startDate: dayjs(currentReportTime).format('YYYY-MM-DD'),
    isFallback: !latestReportTime,
  };
});

router.get(basePath+'/title/:model/:reportDate/:forcastDate', async (ctx) => {
  const { model, reportDate, forcastDate } = ctx.params;
  const mapType = getRequestMapType(ctx);
  if (!mapType || !validateImageRouteParams(mapType, model, reportDate, forcastDate)) {
    ctx.status = 400;
    ctx.body = { status: '参数错误' };
    return;
  }

  try {
    const store = await readTitleStore();
    const titleRecord = store[getTitleKey(mapType, model, reportDate, forcastDate)]
      || (mapType === DEFAULT_MAP_TYPE ? store[getLegacyTitleKey(model, reportDate, forcastDate)] : null);
    ctx.body = {
      title: titleRecord?.title || '',
      isCustom: Boolean(titleRecord?.title),
      updatedAt: titleRecord?.updatedAt || '',
    };
  } catch (err) {
    ctx.status = 500;
    ctx.body = { status: '标题读取失败' };
  }
});

router.post(basePath+'/title/:model/:reportDate/:forcastDate', async (ctx) => {
  const { model, reportDate, forcastDate } = ctx.params;
  const mapType = getRequestMapType(ctx);
  if (!mapType || !validateImageRouteParams(mapType, model, reportDate, forcastDate)) {
    ctx.status = 400;
    ctx.body = { status: '参数错误' };
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(ctx);
  } catch (err) {
    ctx.status = err.message === '请求体过大' ? 413 : 400;
    ctx.body = { status: err.message === '请求体过大' ? '请求体过大' : 'JSON格式错误' };
    return;
  }

  const rawTitle = payload && typeof payload === 'object' ? payload.title : '';
  const title = String(rawTitle || '').trim();
  if (title.length > TITLE_MAX_LENGTH) {
    ctx.status = 400;
    ctx.body = { status: `标题长度不能超过${TITLE_MAX_LENGTH}个字符` };
    return;
  }

  try {
    const store = await readTitleStore();
    const titleKey = getTitleKey(mapType, model, reportDate, forcastDate);
    if (title) {
      const updatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss');
      store[titleKey] = {
        title,
        updatedAt,
      };
    } else {
      delete store[titleKey];
    }
    await writeTitleStore(store);
    ctx.body = {
      title,
      isCustom: Boolean(title),
      updatedAt: store[titleKey]?.updatedAt || '',
    };
  } catch (err) {
    logger.error(`保存标题配置失败: ${titleStorePath} ${err.message}`);
    ctx.status = 500;
    ctx.body = { status: '标题保存失败' };
  }
});

router.delete(basePath+'/title/:model/:reportDate/:forcastDate', async (ctx) => {
  const { model, reportDate, forcastDate } = ctx.params;
  const mapType = getRequestMapType(ctx);
  if (!mapType || !validateImageRouteParams(mapType, model, reportDate, forcastDate)) {
    ctx.status = 400;
    ctx.body = { status: '参数错误' };
    return;
  }

  try {
    const store = await readTitleStore();
    delete store[getTitleKey(mapType, model, reportDate, forcastDate)];
    if (mapType === DEFAULT_MAP_TYPE) {
      delete store[getLegacyTitleKey(model, reportDate, forcastDate)];
    }
    await writeTitleStore(store);
    ctx.body = {
      title: '',
      isCustom: false,
    };
  } catch (err) {
    logger.error(`删除标题配置失败: ${titleStorePath} ${err.message}`);
    ctx.status = 500;
    ctx.body = { status: '标题删除失败' };
  }
});

// 添加图片请求处理路由
router.get(basePath+'/picture/:model/:reportDate/:forcastDate/:fileName?', async (ctx) => {
  const { model, reportDate, forcastDate, fileName } = ctx.params;
  const targetFileName = fileName || IMAGE_NAME;
  const mapType = getRequestMapType(ctx);
  if (!mapType || !validateImageRouteParams(mapType, model, reportDate, forcastDate) || !isSafeImageFileName(targetFileName)) {
    ctx.status = 400;
    ctx.body = { status: '参数错误' };
    return;
  }
  const product = getImageProduct(mapType);
  const modelDir = getModelImageDir(mapType, model);
  logger.info(`图片请求 - mapType: ${mapType}, model: ${model}, reportDate: ${reportDate}, forcastDate: ${forcastDate}, fileName: ${targetFileName}`);
  const imagePath = path.join(modelDir, reportDate, forcastDate, targetFileName);
  const dirPath = path.join(modelDir, reportDate, forcastDate);
  const year = reportDate.slice(0, 4);
  const dateStr = reportDate.slice(0, 8);
  ctx.set('X-Map-Type', mapType);
  ctx.set('X-Layout', product.layout);

  try {
    // 检查文件是否存在并获取状态
    const stats = await fsp.stat(imagePath);

    // 设置缓存控制头
    ctx.set('Cache-Control', 'public, max-age=3600'); // 缓存1小时
    ctx.set('ETag', stats.mtime.getTime().toString()); // 使用文件修改时间作为ETag

    // 检查客户端缓存
    if (ctx.request.headers['if-none-match'] === stats.mtime.getTime().toString()) {
      ctx.status = 304; // 资源未修改
      return;
    }

    // 文件存在，返回图片
    const data = await fsp.readFile(imagePath);
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
      mapType,
      model,
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
      await fsp.access(dirPath, fs.constants.F_OK);
      logger.info(`目录存在: ${dirPath}`);

      // 目录存在，读取目录内容
      const files = await fsp.readdir(dirPath);
      logger.info(`目录内容: ${files.join(', ')}`);

      if (files.length === 0) {
        // 目录存在但无文件 - 模型预测中
        ctx.status = 202;
        ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate'); // 禁止缓存未完成的请求
        ctx.body = { status: '数据预测中' };
        return;
      } else if (!files.includes(targetFileName)) {
        // 目录存在但目标文件不存在
        ctx.status = 404;
        ctx.body = { status: '图片不存在' };
        return;
      }
    } catch (err) {
      logger.error(`目录不存在: ${dirPath} ${JSON.stringify({
        mapType,
        model,
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
