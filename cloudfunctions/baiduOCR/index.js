// 云函数：baiduOCR - 百度AI文字识别（URL方案）
const cloud = require('wx-server-sdk');
const request = require('request');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ⚠️ 请在云开发控制台的环境变量中配置
// 路径：云开发控制台 -> 云函数 -> baiduOCR -> 配置 -> 环境变量
const API_KEY = process.env.BAIDU_API_KEY || '请在环境变量中配置';
const SECRET_KEY = process.env.BAIDU_SECRET_KEY || '请在环境变量中配置';


// 获取access_token（缓存1天）
let accessTokenCache = null;
let tokenExpireTime = 0;

async function getAccessToken() {
  // 如果缓存未过期，直接返回
  if (accessTokenCache && Date.now() < tokenExpireTime) {
    return accessTokenCache;
  }

  return new Promise((resolve, reject) => {
    const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`;
    
    request.post(url, (error, response, body) => {
      if (error) {
        reject(error);
      } else {
        try {
          const result = JSON.parse(body);
          if (result.access_token) {
            accessTokenCache = result.access_token;
            // 缓存29天（百度token有效期30天）
            tokenExpireTime = Date.now() + 29 * 24 * 60 * 60 * 1000;
            resolve(result.access_token);
          } else {
            reject(new Error('获取access_token失败: ' + JSON.stringify(result)));
          }
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

// OCR识别（仅使用图片URL）
function recognizeByUrl(imageUrl, accessToken) {
  return new Promise((resolve, reject) => {
    const url = `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`;
    
    // 设置15秒超时
    const timeout = setTimeout(() => {
      reject(new Error('OCR识别超时（15秒）'));
    }, 15000);
    
    request.post({
      url: url,
      form: {
        url: imageUrl,
        detect_direction: 'true',
        language_type: 'CHN_ENG'
      },
      timeout: 15000 // request库的超时设置
    }, (error, response, body) => {
      clearTimeout(timeout);
      
      if (error) {
        reject(error);
      } else {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

exports.main = async (event) => {
  const startTime = Date.now();
  console.log('[百度OCR] 开始处理请求');
  
  try {
    const { imageUrl } = event;
    
    if (!imageUrl) {
      return {
        success: false,
        error: '缺少图片URL'
      };
    }

    console.log('[百度OCR] 图片URL:', imageUrl);

    // 检查密钥是否配置
    if (API_KEY === '你的API_KEY' || SECRET_KEY === '你的SECRET_KEY') {
      return {
        success: false,
        error: '请先配置百度AI密钥\n\n1. 访问 https://ai.baidu.com/\n2. 创建应用获取API Key和Secret Key\n3. 在云函数中替换密钥\n4. 重新上传云函数'
      };
    }
    
    // 获取access_token
    console.log('[百度OCR] 获取access_token...');
    const tokenStart = Date.now();
    const accessToken = await getAccessToken();
    console.log('[百度OCR] access_token获取成功，耗时:', Date.now() - tokenStart, 'ms');
    
    // 识别文字（仅使用URL方式）
    console.log('[百度OCR] 开始识别文字...');
    const ocrStart = Date.now();
    const result = await recognizeByUrl(imageUrl, accessToken);
    console.log('[百度OCR] 识别完成，耗时:', Date.now() - ocrStart, 'ms');
    
    // 提取文字
    if (result.words_result && result.words_result.length > 0) {
      const text = result.words_result.map(item => item.words).join('\n');
      console.log('[百度OCR] 识别成功，文字行数:', result.words_result.length);
      console.log('[百度OCR] 总耗时:', Date.now() - startTime, 'ms');
      return {
        success: true,
        text: text,
        count: result.words_result.length
      };
    } else if (result.error_code) {
      console.error('[百度OCR] 识别失败:', result.error_msg || result.error_code);
      return {
        success: false,
        error: `识别失败: ${result.error_msg || result.error_code}`
      };
    } else {
      console.log('[百度OCR] 未识别到文字');
      return {
        success: false,
        error: '未识别到文字'
      };
    }
  } catch (err) {
    console.error('[百度OCR] 错误:', err);
    console.log('[百度OCR] 失败耗时:', Date.now() - startTime, 'ms');
    return {
      success: false,
      error: err.message || '识别出错'
    };
  }
};
