import { createWechatPay } from './wechatpay.js';

const port = Number(process.env.PORT ?? 3300);
createWechatPay().listen(port, () => console.log(`wechatpay-mock (MOCK) on ${port}`));
