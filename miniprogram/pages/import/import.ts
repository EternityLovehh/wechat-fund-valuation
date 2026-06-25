// import.ts - 导入持仓页面
import { getFundEstimate, getNetValueByDate, searchFund } from '../../utils/fundApi'
import { addOptionalFund, saveImportedHoldings, ImportedHolding } from '../../utils/storage'
import { parseTransactionRecords, buildHoldingFromTxns, TxRecord } from '../../utils/holdingCalc'
import { getTodayStr } from '../../utils/appDate'

interface ImportItem {
  code: string;
  name: string;
  amount?: number; // 持有金额
  profit?: number; // 持有收益
  profitRate?: number; // 收益率
  shares?: number; // 份额（用于手动输入原格式）
  cost?: number; // 成本（用于手动输入原格式）
  pendingAdd?: number; // 今日加仓金额（确认前不计收益）
}

// 当前日期 YYYY-MM-DD（走统一开关，便于调试时整体覆盖）
function todayStr(): string {
  return getTodayStr();
}

Page({
  data: {
    importText: '',
    importList: [] as ImportItem[],
    importing: false,
    activeTab: 'txn' as 'batch' | 'ocr' | 'txn',
    ocrImages: [] as string[],
    ocrResult: '',
    recognizing: false,
    // 新选手手动输入字段
    inputCodeOrName: '',
    inputAmount: '',
    inputProfit: '',
    inputPendingAdd: '', // 今日加仓金额（可选）
    // 交易记录导入
    txnText: ''
  },

  onLoad() {
    // 检查云开发是否初始化
    if (!wx.cloud) {
      console.warn('云开发未初始化，OCR功能将不可用');
    }
  },

  // 输入处理
  onCodeInput(e: any) {
    this.setData({ inputCodeOrName: e.detail.value });
  },
  onAmountInput(e: any) {
    this.setData({ inputAmount: e.detail.value });
  },
  onProfitInput(e: any) {
    this.setData({ inputProfit: e.detail.value });
  },
  onPendingAddInput(e: any) {
    this.setData({ inputPendingAdd: e.detail.value });
  },
  onTxnInput(e: any) {
    this.setData({ txnText: e.detail.value });
  },
  pasteTxnFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        if (res.data) {
          this.setData({ txnText: res.data });
          wx.showToast({ title: '已粘贴', icon: 'success' });
        } else {
          wx.showToast({ title: '剪贴板为空', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '粘贴失败', icon: 'none' })
    });
  },

  // 添加到待导入列表
  addToList() {
    const { inputCodeOrName, inputAmount, inputProfit } = this.data;
    
    if (!inputCodeOrName.trim()) {
      wx.showToast({ title: '请输入代码或名称', icon: 'none' });
      return;
    }
    
    const { inputPendingAdd } = this.data;
    const amount = parseFloat(inputAmount);
    const profit = parseFloat(inputProfit);
    const pendingAdd = parseFloat(inputPendingAdd);

    if (isNaN(amount) || amount <= 0) {
      wx.showToast({ title: '请输入正确金额', icon: 'none' });
      return;
    }

    if (isNaN(profit)) {
      wx.showToast({ title: '请输入正确收益', icon: 'none' });
      return;
    }

    // 加仓金额可选；填了则不能超过总持有金额
    const hasPendingAdd = !isNaN(pendingAdd) && pendingAdd > 0;
    if (hasPendingAdd && pendingAdd > amount) {
      wx.showToast({ title: '加仓金额不能超过持有金额', icon: 'none' });
      return;
    }

    const newItem: ImportItem = {
      code: inputCodeOrName.trim(),
      name: inputCodeOrName.trim(),
      amount,
      profit,
      pendingAdd: hasPendingAdd ? pendingAdd : 0
    };

    const importList = this.data.importList;
    // 检查是否已在列表中
    if (importList.some(item => item.code === newItem.code)) {
      wx.showToast({ title: '该基金已在待导入列表中', icon: 'none' });
      return;
    }

    importList.push(newItem);
    this.setData({
      importList,
      inputCodeOrName: '',
      inputAmount: '',
      inputProfit: '',
      inputPendingAdd: ''
    });
    
    wx.showToast({ title: '已添加', icon: 'success' });
  },


  // 切换标签
  switchTab(e: any) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      activeTab: tab,
      importList: [],
      txnText: ''
    });
  },

  // 批量导入文本输入
  onTextInput(e: any) {
    this.setData({ importText: e.detail.value });
  },

  // 粘贴剪贴板内容
  pasteFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const text = res.data;
        if (text) {
          this.setData({ importText: text });
          wx.showToast({ title: '已粘贴', icon: 'success' });
        } else {
          wx.showToast({ title: '剪贴板为空', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '粘贴失败', icon: 'none' });
      }
    });
  },

  // 清空输入
  clearInput() {
    this.setData({ 
      importText: '',
      importList: []
    });
  },

  // OCR结果输入
  onOcrResultInput(e: any) {
    this.setData({ ocrResult: e.detail.value });
  },

  // 清空OCR结果
  clearOcrResult() {
    this.setData({ 
      ocrResult: '',
      importList: []
    });
  },

  // 显示OCR配置指南
  showOcrGuide() {
    wx.showModal({
      title: 'OCR配置指南',
      content: '使用百度AI OCR服务\n\n✅ 50,000次免费额度\n✅ 识别准确率高\n✅ 识别速度快\n\n需要配置API Key\n查看：百度OCR配置指南.md',
      confirmText: '知道了',
      showCancel: false
    });
  },

  // 选择图片（支持多选）
  chooseImage() {
    console.log('chooseImage 方法被调用');
    
    wx.chooseMedia({
      count: 9, // 最多9张图片
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        console.log('选择图片成功:', res);
        const images = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ 
          ocrImages: images,
          ocrResult: '',
          importList: []
        });
        wx.showToast({ 
          title: `已选择${images.length}张图片`, 
          icon: 'success' 
        });
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
        wx.showToast({ 
          title: '选择图片失败', 
          icon: 'none' 
        });
      }
    });
  },

  // 重新选择图片
  reselectImage() {
    this.setData({ 
      ocrImages: [],
      ocrResult: '',
      importList: []
    });
  },

  // 删除某张图片
  removeImage(e: any) {
    const index = e.currentTarget.dataset.index;
    const ocrImages = this.data.ocrImages;
    ocrImages.splice(index, 1);
    this.setData({ ocrImages });
    
    if (ocrImages.length === 0) {
      this.setData({ ocrResult: '', importList: [] });
    }
  },

  // 识别所有图片
  async recognizeImage() {
    const { ocrImages } = this.data;
    if (ocrImages.length === 0) {
      wx.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }

    // 检查云开发
    if (!wx.cloud) {
      wx.showModal({
        title: 'OCR功能不可用',
        content: '请先初始化云开发\n\n查看 百度OCR配置指南.md 了解详情',
        showCancel: false
      });
      return;
    }

    this.setData({ recognizing: true });

    let allText = '';
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ocrImages.length; i++) {
      try {
        wx.showLoading({ title: `识别中 ${i + 1}/${ocrImages.length}` });
        
        // 上传到云存储
        const cloudPath = `ocr-temp/${Date.now()}-${i}.jpg`;
        const uploadResult = await wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: ocrImages[i]
        });

        console.log('上传成功:', uploadResult.fileID);

        // 获取临时URL（有效期1小时）
        const tempUrlResult = await wx.cloud.getTempFileURL({
          fileList: [uploadResult.fileID]
        });

        const imageUrl = tempUrlResult.fileList[0].tempFileURL;
        console.log('临时URL:', imageUrl);
        
        // 如果不是第一张图片，等待1秒避免QPS限制
        if (i > 0) {
          console.log('等待1秒避免QPS限制...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // 调用云函数（使用百度OCR）
        const result: any = await wx.cloud.callFunction({
          name: 'baiduOCR',
          data: {
            imageUrl: imageUrl
          }
        });

        console.log('识别结果:', result);

        // 删除临时文件
        await wx.cloud.deleteFile({
          fileList: [uploadResult.fileID]
        });

        if (result.result && result.result.success) {
          allText += result.result.text + '\n';
          successCount++;
        } else {
          console.error('识别失败:', result.result?.error);
          failCount++;
          
          // 如果是密钥未配置错误，立即停止
          if (result.result?.error && (
            result.result.error.includes('配置百度AI密钥') ||
            result.result.error.includes('今日免费额度已用完')
          )) {
            wx.hideLoading();
            wx.showModal({
              title: 'OCR提示',
              content: result.result.error,
              showCancel: false
            });
            this.setData({ recognizing: false });
            return;
          }
        }
      } catch (e: any) {
        console.error('识别失败:', e);
        failCount++;
        
        // 显示具体错误信息
        const errorMsg = e.errMsg || e.message || '未知错误';
        console.error('错误详情:', errorMsg);
      }
    }

    wx.hideLoading();

    console.log('=== 所有图片识别完成 ===');
    console.log('成功:', successCount, '失败:', failCount);
    console.log('识别到的所有文字:', allText);

    if (allText && this.data.activeTab === 'txn') {
      // 交易记录模式：原始文本直接交给交易记录解析，不走持仓提取
      this.setData({ txnText: allText, recognizing: false });
      wx.showModal({
        title: '识别完成',
        content: '已识别交易记录文本，是否立即解析并导入？',
        confirmText: '解析导入',
        cancelText: '先检查',
        success: (res) => {
          if (res.confirm) this.importTransactions();
        }
      });
      return;
    }

    if (allText) {
      // 自动提取基金信息
      const extractedText = this.extractFundInfo(allText);
      console.log('提取后的文本:', extractedText);
      
      this.setData({ 
        ocrResult: extractedText,
        recognizing: false 
      });

      // 自动解析数据
      if (extractedText && extractedText.trim()) {
        this.parseExtractedText(extractedText);
        
        // 等待解析完成后自动导入
        setTimeout(() => {
          if (this.data.importList.length > 0) {
            wx.showModal({
              title: '识别完成',
              content: `成功识别 ${this.data.importList.length} 个基金\n是否立即导入到持仓？`,
              confirmText: '立即导入',
              cancelText: '稍后导入',
              success: (res) => {
                if (res.confirm) {
                  this.doImport();
                } else {
                  wx.showToast({ 
                    title: '请点击"导入"按钮', 
                    icon: 'none',
                    duration: 2000
                  });
                }
              }
            });
          } else {
            wx.showModal({
              title: '识别完成',
              content: `成功识别${successCount}张图片\n但未能提取到基金信息\n\n请确保图片包含：\n- 基金代码（6位数字）\n- 持有份额\n- 成本价格`,
              showCancel: false
            });
          }
        }, 100);
      } else {
        wx.showModal({
          title: '识别完成',
          content: `成功识别${successCount}张图片\n但未能提取到基金信息\n\n请确保图片包含：\n- 基金代码（6位数字）\n- 持有份额\n- 成本价格`,
          showCancel: false
        });
      }
    } else {
      this.setData({ recognizing: false });
      
      if (failCount > 0) {
        wx.showModal({
          title: '识别失败',
          content: '可能原因：\n1. 图片不清晰\n2. 网络问题\n3. 今日免费额度已用完（500次/天）\n\n建议：\n- 使用相机拍照（更清晰）\n- 检查网络连接\n- 或使用手动输入（完全免费）',
          showCancel: false
        });
      } else {
        wx.showToast({ 
          title: '未识别到文字\n请确保图片清晰', 
          icon: 'none',
          duration: 2000
        });
      }
    }
  },



  // 智能提取基金信息（支付宝格式）
  extractFundInfo(text: string): string {
    console.log('=== 开始提取基金信息（支付宝格式）===');
    console.log('原始文本:', text);
    
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    console.log('分割后的行数:', lines.length);
    
    const results: string[] = [];
    
    // 干扰词列表
    const interferenceWords = [
      '更新时间', '排序', '全部', '偏股', '偏债', '指数', '黄金', '全球',
      '名称', '金额', '昨日收益', '持有收益', '我的持有', '基金市场',
      '机会', '自选', '持有', '财富号', '市场解读', '金选', '超额收益',
      '更多产品', '去市场看看', '基金销售', '蚂蚁', '杭州', '法律文件',
      '收益数据', '仅供参考', '过往业绩', '市场有风险', '投资需谨慎'
    ];
    
    // 判断是否是干扰行
    const isInterferenceLine = (line: string): boolean => {
      if (/^[\d:]+$/.test(line) || /^\d{1,2}:\d{2}/.test(line)) return true;
      if (line.length < 2) return true;
      if (interferenceWords.some(word => line.includes(word))) return true;
      if (line.includes('>') || line.includes('？') || line.includes('图')) return true;
      if (/^[^\u4e00-\u9fa5A-Za-z]+$/.test(line) && line.length < 3) return true;
      return false;
    };
    
    // 判断是否是有效的基金名称部分
    const isValidNamePart = (line: string): boolean => {
      // 必须包含中文或英文字母
      if (!/[\u4e00-\u9fa5A-Z]/.test(line)) return false;
      // 长度在2-20之间
      if (line.length < 2 || line.length > 20) return false;
      // 只能包含中文、英文、数字
      if (!/^[A-Za-z\u4e00-\u9fa5\d]+$/.test(line)) return false;
      return true;
    };
    
    // 判断是否是"文本行"（基金名称行）：比 isValidNamePart 宽松，允许名字里带 ()（）·&- 等，
    // 用于金额锚点的"前一行"判断。关键在于排除数字/百分比行——收益数字的前一行总是金额（数字），据此可区分。
    const looksLikeName = (line: string): boolean => {
      if (!line) return false;
      // 数字 / 带符号数字 / 百分比 一律不是名称
      if (/^[+\-]?[\d,]+\.?\d*%?$/.test(line)) return false;
      // 至少包含 2 个连续的中文或字母
      if (!/[一-龥A-Za-z]{2}/.test(line)) return false;
      // 过长的多半是广告/提示语，不是名称
      if (line.length > 24) return false;
      return true;
    };

    // 找到所有金额锚点。用两个互补信号判定，避免单一规则误判/漏判：
    //   信号①：最近的非空前一行是"文本行"（名称），且不是数字 —— 收益数字 0.00 的前一行是金额，被排除。
    //   信号②：该行之后的若干行内出现收益率（%），确认这是一条真正的持仓行，而非杂项数字。
    const amountLines: number[] = [];
    lines.forEach((line, index) => {
      if (!/^[\d,]+\.\d{2}$/.test(line)) return;
      // 持有金额不可能是 0.00：排除"0.00"昨日收益等被误当成金额锚点
      if (parseFloat(line.replace(/,/g, '')) <= 0) return;
      // 信号①：前一行是名称
      let prev = index - 1;
      while (prev >= 0 && !lines[prev].trim()) prev--;
      if (prev < 0 || !looksLikeName(lines[prev])) return;
      // 信号②：向后 6 行内存在收益率
      let hasRate = false;
      for (let j = index + 1; j < Math.min(index + 7, lines.length); j++) {
        if (/^[+\-]?[\d.]+%$/.test(lines[j])) { hasRate = true; break; }
      }
      if (!hasRate) {
        console.log(`跳过疑似金额 第${index+1}行: ${line}（附近无收益率，可能不是持仓行）`);
        return;
      }
      amountLines.push(index);
      console.log(`找到金额锚点 第${index+1}行: ${line}（名称: ${lines[prev]}）`);
    });
    
    console.log(`共找到 ${amountLines.length} 个金额锚点`);
    
    // 对每个金额锚点进行处理
    for (let i = 0; i < amountLines.length; i++) {
      const amountIndex = amountLines[i];
      const amount = lines[amountIndex].replace(/,/g, '');
      console.log(`\n=== 处理金额锚点 第${amountIndex+1}行: ${lines[amountIndex]} ===`);
      
      // 窗口范围：从当前金额到下一个金额锚点之间
      let nextAmountIndex = amountLines[i + 1] || lines.length;
      const windowEnd = Math.min(nextAmountIndex, lines.length);

      // 第一步：在窗口内定位收益率（百分比），作为这一行基金的右边界
      let rateIndex = -1;
      let profitRate = '';
      for (let j = amountIndex + 1; j < windowEnd; j++) {
        if (/^[+\-]?[\d.]+%$/.test(lines[j])) {
          profitRate = lines[j];
          rateIndex = j;
          console.log(`  第${j+1}行: 找到收益率 = ${profitRate}`);
          break;
        }
      }

      // 第二步：持有收益 = 收益率之前最后一个金额数值（带符号或不带符号，0.00 也算）
      // 取"最后一个"可避开靠前的昨日收益，得到真正的持有收益；新买入/零收益基金显示为 0.00
      let profitIndex = -1;
      let totalProfit = '';
      const numberEnd = rateIndex > 0 ? rateIndex : Math.min(amountIndex + 6, windowEnd);
      for (let j = amountIndex + 1; j < numberEnd; j++) {
        if (/^[+\-]?[\d,]+\.\d{2}$/.test(lines[j])) {
          totalProfit = lines[j].replace(/,/g, '');
          profitIndex = j;
        }
      }
      if (!totalProfit) {
        totalProfit = '0.00';
        console.log('  未找到持有收益数值，默认为 0.00');
      } else {
        console.log(`  第${profitIndex+1}行: 找到持有收益 = ${totalProfit}`);
      }

      // 第三步：在金额与收益率之间收集名称后缀（份额类别等）
      let nameSuffix = '';
      const suffixEnd = rateIndex > 0 ? rateIndex : Math.min(amountIndex + 6, windowEnd);
      for (let j = amountIndex + 1; j < suffixEnd; j++) {
        const line = lines[j];
        // 跳过数值和百分比
        if (/^[+\-]?[\d,]+\.\d{2}$/.test(line)) continue;
        if (/^[+\-]?[\d.]+%$/.test(line)) continue;
        // 份额类别（单独的 A/B/C 字母）
        if (/^[ABC]$/.test(line)) {
          nameSuffix += line;
          console.log(`  第${j+1}行: 找到份额类别 = ${line}`);
          continue;
        }
        // 名称后缀（有效文本）
        if (isValidNamePart(line)) {
          nameSuffix += line;
          console.log(`  第${j+1}行: 找到名称后缀 = ${line}`);
        }
      }
      
      // 第四步：向前查找名称前缀
      let namePrefix = '';
      let searchStart = i > 0 ? amountLines[i - 1] + 1 : 0;
      
      // 从金额前一行开始向前搜索（只找最近的一个有效名称）
      for (let j = amountIndex - 1; j >= searchStart; j--) {
        const line = lines[j];
        
        // 如果遇到收益率，说明到了上一个基金，停止
        if (/^[+\-][\d.]+%$/.test(line)) {
          console.log(`  第${j+1}行: 遇到收益率，停止向前搜索`);
          break;
        }
        
        // 如果遇到金额，说明到了上一个基金，停止
        if (/^[\d,]+\.\d{2}$/.test(line)) {
          console.log(`  第${j+1}行: 遇到金额，停止向前搜索`);
          break;
        }
        
        // 找到有效的名称部分
        if (isValidNamePart(line)) {
          namePrefix = line;
          console.log(`  第${j+1}行: 找到名称前缀 = ${namePrefix}`);
          break; // 只取最近的一个
        }
      }
      
      // 第五步：组合完整的基金名称
      const fundName = namePrefix + nameSuffix;
      console.log(`  组合后的完整名称: ${fundName}`);
      
      // 验证并保存数据
      if (fundName && amount && totalProfit) {
        const result = `NAME:${fundName}|AMOUNT:${amount}|PROFIT:${totalProfit}|RATE:${profitRate || '0%'}`;
        console.log(`  ✓ 保存基金数据: ${result}`);
        results.push(result);
      } else {
        console.log(`  ✗ 数据不完整，跳过 (名称:${fundName}, 金额:${amount}, 收益:${totalProfit})`);
      }
    }
    
    console.log('\n=== 提取完成 ===');
    console.log('提取到的基金数量:', results.length);
    
    // 打印所有识别出的基金
    console.log('\n=== 识别结果汇总 ===');
    results.forEach((result, index) => {
      const nameMatch = result.match(/NAME:([^|]+)/);
      const amountMatch = result.match(/AMOUNT:([\d.]+)/);
      const profitMatch = result.match(/PROFIT:([^|]+)/);
      const rateMatch = result.match(/RATE:([^|]+)/);
      
      if (nameMatch) {
        console.log(`${index + 1}. ${nameMatch[1]}`);
        console.log(`   持有金额: ${amountMatch ? amountMatch[1] : '未知'}`);
        console.log(`   持有收益: ${profitMatch ? profitMatch[1] : '未知'}`);
        console.log(`   收益率: ${rateMatch ? rateMatch[1] : '未知'}`);
      }
    });
    console.log('========================\n');
    
    const finalResult = results.join('\n');
    return finalResult;
  },

  // 解析提取的文本（自动调用）
  parseExtractedText(text: string) {
    console.log('开始解析提取的文本:', text);
    
    if (!text || !text.trim()) {
      console.log('文本为空，跳过解析');
      return;
    }

    const lines = text.split('\n').filter(line => line.trim());
    console.log('分割后的行数:', lines.length, lines);
    
    const importList: ImportItem[] = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      console.log(`第${lineNum}行解析:`, line);
      
      // 检查是否是新格式：NAME:xxx|AMOUNT:xxx|PROFIT:xxx|RATE:xxx
      if (line.includes('NAME:') && line.includes('AMOUNT:')) {
        const nameMatch = line.match(/NAME:([^|]+)/);
        const amountMatch = line.match(/AMOUNT:([\d.]+)/);
        const profitMatch = line.match(/PROFIT:([+\-]?[\d.]+)/);
        const rateMatch = line.match(/RATE:([+\-]?[\d.]+)%?/);
        
        if (nameMatch && amountMatch) {
          const name = nameMatch[1].trim();
          const amount = parseFloat(amountMatch[1]);
          const profit = profitMatch ? parseFloat(profitMatch[1]) : 0;
          const profitRate = rateMatch ? parseFloat(rateMatch[1]) : 0;
          
          console.log(`  识别到基金: ${name}, 金额: ${amount}, 收益: ${profit}, 收益率: ${profitRate}%`);
          
          importList.push({
            code: name, // 临时使用名称，后续会搜索真实代码
            name: name,
            amount: amount,
            profit: profit,
            profitRate: profitRate
          });
          continue;
        }
      }
      
      // 原有格式：基金代码 份额 成本
      const parts = line.split(/[\s,|，\t]+/).filter(p => p.trim());
      console.log(`第${lineNum}行解析:`, parts);
      
      if (parts.length < 3) {
        errors.push(`第${lineNum}行格式错误：缺少数据`);
        continue;
      }

      const code = parts[0].trim();
      const shares = parseFloat(parts[1]);
      const cost = parseFloat(parts[2]);
      
      // 验证基金代码（6位数字）
      if (!/^\d{6}$/.test(code)) {
        errors.push(`第${lineNum}行：基金代码"${code}"格式错误（应为6位数字）`);
        continue;
      }

      // 验证份额
      if (isNaN(shares) || shares <= 0) {
        errors.push(`第${lineNum}行：份额"${parts[1]}"无效（应为正数）`);
        continue;
      }

      // 验证成本
      if (isNaN(cost) || cost <= 0) {
        errors.push(`第${lineNum}行：成本"${parts[2]}"无效（应为正数）`);
        continue;
      }

      importList.push({
        code,
        name: `基金${code}`,
        shares,
        cost
      });
    }

    console.log('解析结果 - 成功:', importList.length, '错误:', errors.length);
    console.log('导入列表:', importList);

    // 显示结果
    if (importList.length === 0) {
      wx.showModal({
        title: '解析失败',
        content: errors.length > 0 ? errors.join('\n') : '未识别到有效数据',
        showCancel: false
      });
      return;
    }

    this.setData({ importList });
    console.log('已设置 importList 到 data');

    // 显示解析结果
    let message = `成功识别${importList.length}条数据`;
    if (errors.length > 0) {
      message += `\n${errors.length}条错误`;
    }

    // 如果有错误，显示详情
    if (errors.length > 0 && errors.length <= 5) {
      setTimeout(() => {
        wx.showModal({
          title: '部分数据有误',
          content: errors.join('\n'),
          showCancel: false
        });
      }, 1000);
    }
  },

  // 解析OCR结果
  parseOcrResult() {
    const { ocrResult } = this.data;
    if (!ocrResult.trim()) {
      wx.showToast({ title: '请先识别图片', icon: 'none' });
      return;
    }
    
    this.setData({ importText: ocrResult });
    this.parseImportText();
  },

  // 解析导入文本
  parseImportText() {
    const { importText } = this.data;
    if (!importText.trim()) {
      wx.showToast({ title: '请输入持仓数据', icon: 'none' });
      return;
    }

    const lines = importText.split('\n').filter(line => line.trim());
    const importList: ImportItem[] = [];
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      // 支持多种分隔符：空格、逗号、制表符、竖线
      const parts = line.split(/[\s,|，\t]+/).filter(p => p.trim());
      
      if (parts.length < 3) {
        errors.push(`第${lineNum}行格式错误：缺少数据`);
        continue;
      }

      const code = parts[0].trim();
      const shares = parseFloat(parts[1]);
      const cost = parseFloat(parts[2]);
      
      // 验证基金代码（6位数字）
      if (!/^\d{6}$/.test(code)) {
        errors.push(`第${lineNum}行：基金代码"${code}"格式错误（应为6位数字）`);
        continue;
      }

      // 验证份额
      if (isNaN(shares) || shares <= 0) {
        errors.push(`第${lineNum}行：份额"${parts[1]}"无效（应为正数）`);
        continue;
      }

      // 验证成本
      if (isNaN(cost) || cost <= 0) {
        errors.push(`第${lineNum}行：成本"${parts[2]}"无效（应为正数）`);
        continue;
      }

      importList.push({
        code,
        name: `基金${code}`,
        shares,
        cost
      });
    }

    // 显示结果
    if (importList.length === 0) {
      wx.showModal({
        title: '解析失败',
        content: errors.length > 0 ? errors.join('\n') : '未识别到有效数据\n\n格式：基金代码 份额 成本\n示例：110022 1000 2.5678',
        showCancel: false
      });
      return;
    }

    this.setData({ importList });

    // 显示解析结果
    let message = `成功识别${importList.length}条数据`;
    if (errors.length > 0) {
      message += `\n${errors.length}条错误`;
    }

    wx.showToast({ 
      title: message,
      icon: importList.length > 0 ? 'success' : 'none',
      duration: 2000
    });

    // 如果有错误，显示详情
    if (errors.length > 0 && errors.length <= 5) {
      setTimeout(() => {
        wx.showModal({
          title: '部分数据有误',
          content: errors.join('\n'),
          showCancel: false
        });
      }, 2000);
    }
  },

  // 执行导入
  async doImport() {
    const { importList } = this.data;
    console.log('开始导入，数据列表:', importList);
    
    if (importList.length === 0) {
      wx.showToast({ title: '没有可导入的数据', icon: 'none' });
      return;
    }

    this.setData({ importing: true });
    wx.showLoading({ title: '导入中...' });

    const importedHoldings: ImportedHolding[] = [];
    let successCount = 0;

    for (const item of importList) {
      try {
        console.log('正在导入基金:', item.code, item.name);

        // 跳过解析噪声：金额≤0 的条目（如把"0.00"昨日收益误当成持有金额的假识别）
        const itemAmount = Number(item.amount) || 0;
        const itemShares = Number(item.shares) || 0;
        if (itemAmount <= 0 && itemShares <= 0) {
          console.warn('跳过无效条目（金额为0）:', item.code, item.name);
          continue;
        }

        // 简单处理：如果是代码直接用，如果是名称则搜索
        let fundCode = item.code;
        let fundName = item.name;

        // 搜索并验证基金
        const searchResults = await searchFund(item.code);
        if (searchResults && searchResults.length > 0) {
          fundCode = searchResults[0].code;
          fundName = searchResults[0].name;
        } else if (!/^\d{6}$/.test(fundCode)) {
           // 无法识别的名称
           console.error('无法识别基金:', item.code);
           continue;
        }

        // 锚定：获取当前净值计算份额
        const fundInfo = await getFundEstimate(fundCode);
        const netValue = Number(fundInfo.netValue) || Number(fundInfo.estimatedValue) || 1;
        const amount = item.amount || 0;
        const profit = item.profit || 0;
        const pendingAdd = item.pendingAdd || 0;
        const today = todayStr();

        // 已确认部分按当前净值锚定份额/成本；加仓部分挂待确认 lot，确认前不计收益。
        let shares = 0;
        let cost = 0;
        let importNetValue = 0;
        const pendingAdds: { amount: number; date: string }[] = [];

        if (pendingAdd > 0) {
          // 只有显式填了加仓金额，才拆出待确认部分：已确认 = 总额 − 加仓
          const confirmedAmount = amount - pendingAdd;
          pendingAdds.push({ amount: pendingAdd, date: today });
          if (confirmedAmount > 0 && netValue > 0) {
            shares = confirmedAmount / netValue;
            cost = (confirmedAmount - profit) / shares;
            importNetValue = netValue;
          }
        } else if (netValue > 0) {
          // 普通导入：整笔按当前净值锚定为已确认持仓（不再靠"收益=0"猜测待确认）
          shares = amount / netValue;
          cost = (amount - profit) / shares;
          importNetValue = netValue;
        }

        importedHoldings.push({
          code: fundCode,
          name: fundName,
          importTime: Date.now(),
          shares,
          cost,
          importNetValue,
          pendingAdds,
          amount,
          profit,
          profitRate: (amount > 0 ? (profit / amount) : 0) * 100
        });

        addOptionalFund(fundCode, fundName);
        successCount++;
      } catch (e) {
        console.error('导入条目失败:', e);
      }
    }

    if (importedHoldings.length > 0) {
      saveImportedHoldings(importedHoldings);
    }

    wx.hideLoading();
    this.setData({ importing: false, importList: [] });
    
    wx.showToast({ title: `成功导入${successCount}个基金`, icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/holding/holding' });
    }, 1500);
  },


  // 从交易记录文本全自动导入：解析每笔买卖 → 按基金分组 → 查历史净值折份额 → 拆分已确认/待确认
  async importTransactions() {
    const text = this.data.txnText;
    if (!text || !text.trim()) {
      wx.showToast({ title: '请先粘贴或识别交易记录', icon: 'none' });
      return;
    }

    const records = parseTransactionRecords(text);
    if (records.length === 0) {
      wx.showModal({
        title: '未识别到交易记录',
        content: '请确认文本包含：买入/卖出、基金名称、金额、日期。\n例如：\n买入 基金|华夏国证半导体芯片ETF联接C 1,000.00元\n2026-06-24 14:56:28 交易进行中',
        showCancel: false
      });
      return;
    }

    this.setData({ importing: true });
    wx.showLoading({ title: '处理交易记录...' });

    // 先按名称分组（减少搜索次数）
    const byName = new Map<string, TxRecord[]>();
    for (const r of records) {
      const arr = byName.get(r.name) || [];
      arr.push(r);
      byName.set(r.name, arr);
    }

    // 解析每个名称的基金代码，再按"代码"归并：
    // OCR 常把同一只基金的不同行识别成略有差异的名字（多空格等），
    // 若按名字分组会拆成多条、最终按 code 覆盖丢数据。统一按 code 合并所有交易。
    const byCode = new Map<string, { code: string; name: string; recs: TxRecord[] }>();
    let skipCount = 0;
    for (const [name, recs] of byName) {
      try {
        const searchResults = await searchFund(name);
        if (!searchResults || searchResults.length === 0) {
          console.warn('交易记录无法匹配基金:', name);
          skipCount++;
          continue;
        }
        const code = searchResults[0].code;
        const existing = byCode.get(code);
        if (existing) {
          existing.recs.push(...recs);
        } else {
          byCode.set(code, { code, name: searchResults[0].name, recs: [...recs] });
        }
      } catch (e) {
        console.error('交易记录匹配失败:', name, e);
        skipCount++;
      }
    }

    const importedHoldings: ImportedHolding[] = [];
    let successCount = 0;

    for (const { code: fundCode, name: fundName, recs } of byCode.values()) {
      try {
        // 当前已确认净值/日期：最新一笔确认买入通常就在这天，可免查历史净值接口
        const est = await getFundEstimate(fundCode);
        const curNav = Number(est.netValue) || 0;
        const curDate = est.valuationDate || '';
        const navByDate: Record<string, number> = {};
        if (curDate && curNav > 0) navByDate[curDate] = curNav;

        // 其余"已确认买入/卖出"申请日再查历史净值（进行中的不查，直接挂待确认）
        const datesToFetch = Array.from(
          new Set(recs.filter(r => r.status === 'confirmed').map(r => r.date))
        ).filter(date => navByDate[date] === undefined);
        await Promise.all(datesToFetch.map(async (date) => {
          navByDate[date] = await getNetValueByDate(fundCode, date);
        }));

        const holding = buildHoldingFromTxns(fundCode, fundName, recs, navByDate, Date.now(), curNav);

        // 已确认份额和待确认都为空 → 这只其实没有有效持仓（全是关闭/无净值），跳过
        if (!(holding.shares && holding.shares > 0) && (holding.pendingAdds || []).length === 0) {
          skipCount++;
          continue;
        }

        importedHoldings.push(holding);
        addOptionalFund(fundCode, fundName);
        successCount++;
      } catch (e) {
        console.error('交易记录导入失败:', fundCode, e);
        skipCount++;
      }
    }

    if (importedHoldings.length > 0) {
      saveImportedHoldings(importedHoldings);
    }

    wx.hideLoading();
    this.setData({ importing: false, txnText: '' });

    if (successCount > 0) {
      wx.showToast({ title: `成功导入${successCount}个基金`, icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/holding/holding' });
      }, 1500);
    } else {
      wx.showModal({
        title: '导入失败',
        content: `未能识别有效持仓${skipCount > 0 ? `（跳过 ${skipCount} 条）` : ''}。请检查交易记录文本是否完整。`,
        showCancel: false
      });
    }
  },

  // 删除某一项
  removeItem(e: any) {
    const index = e.currentTarget.dataset.index;
    const importList = this.data.importList;
    importList.splice(index, 1);
    this.setData({ importList });
  },

  // 使用示例
  showExample() {
    wx.showModal({
      title: '导入格式说明',
      content: '每行一个基金，格式：\n基金代码 份额 成本价\n\n示例：\n110022 1000 2.5678\n161725 500 3.1234\n320007 800 1.9876\n\n支持空格、逗号、竖线分隔',
      showCancel: false
    });
  },

  // 从支付宝导入说明
  showAlipayGuide() {
    wx.showModal({
      title: '从支付宝导入',
      content: '方法1：批量导入\n手动输入基金信息\n\n方法2：扫描识别\n截图支付宝持仓，自动识别\n\n💡 OCR需要先添加插件',
      confirmText: '知道了',
      showCancel: false
    });
  },

  // 显示导入模板
  showTemplate() {
    const template = `110022 1000 2.5678
161725 500 3.1234
320007 800 1.9876`;
    
    this.setData({ importText: template });
    
    wx.showModal({
      title: '已填入示例',
      content: '这是导入格式示例\n\n请替换为你的实际数据：\n• 第1列：基金代码\n• 第2列：持有份额\n• 第3列：成本价\n\n每行一个基金，用空格分隔',
      confirmText: '知道了',
      showCancel: false
    });
  }
})
