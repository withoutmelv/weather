require('dotenv').config();
const path = require('path');

const imageDataPath = path.resolve(__dirname, process.env.OUTPUT_DIR);
const staticResourcePath = path.resolve(__dirname, process.env.STATIC_RESOURCE_PATH);


module.exports = {
  imageDataPath,
  staticResourcePath,
}