import TelegramBot from 'node-telegram-bot-api';
import WebSocket from 'ws';
import { Bot } from './bot';
import { WSMessage } from './types';
import { catchException, logger } from './utils';

let bot: Bot;
let ws: WebSocket;
let pingInterval;

const close = () => {
  logger.warn(`Close server`);
  ws.terminate();
  process.exit();
};

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
process.on('exit', () => {
  logger.warn(`Exit process`);
});

if (!process.env.SERVER || !process.env.TELEGRAM_TOKEN || !process.env.CONFIG) {
  if (!process.env.SERVER) {
    logger.warn(`Missing env variable SERVER`);
  }
  if (!process.env.CONFIG) {
    logger.warn(`Missing env variable CONFIG`);
  }
  if (!process.env.TELEGRAM_TOKEN) {
    logger.warn(`Missing env variable TELEGRAM_TOKEN`);
  }
  close();
} else if (!process.env.LOCAL_SERVER) {
  logger.warn(`Missing env variable LOCAL_SERVER`);
}

const telegramBot = new TelegramBot(String(process.env.TELEGRAM_TOKEN), { polling: true });

telegramBot.on('channel_post', (message) => {
  const msg = bot.convertMessage(message);
  if (msg.conversation.id == bot.config.broadcastConversationId) {
    bot.broadcast('all', String(bot.config.broadcastReceiverId), msg.content, msg.type, msg.extra);
  } else {
    const data: WSMessage = {
      bot: 'polaris',
      platform: 'telegram',
      type: 'message',
      message: msg,
    };
    ws.send(JSON.stringify(data));
  }
});

telegramBot.on('message', (message) => {
  const msg = bot.convertMessage(message);
  const data: WSMessage = {
    bot: 'polaris',
    platform: 'telegram',
    type: 'message',
    message: msg,
  };
  ws.send(JSON.stringify(data));
});

const connectWebSocket = (url: string, timeoutMs = 5000): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);

    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket connection timed out'));
    }, timeoutMs);

    socket.on('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.on('error', (err: any) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

const poll = async (): Promise<void> => {
  let wsConnected = false;

  try {
    ws = await connectWebSocket(process.env.SERVER!);
    wsConnected = true;
    logger.info('Connected to public WebSocket');
  } catch (err: any) {
    const networkErrors = ['ECONNREFUSED', 'ETIMEDOUT'];
    if (networkErrors.includes(err.code)) {
      logger.warn('Public WebSocket failed, trying local...', err.message);
      try {
        ws = await connectWebSocket(process.env.LOCAL_SERVER!);
        wsConnected = true;
        logger.info('Connected to local WebSocket');
      } catch (localErr) {
        logger.error('Both public and local WebSocket failed', localErr);
      }
    } else if (err.message.includes('403')) {
      logger.error('Public WebSocket rejected by Cloudflare (403). Cannot fallback to local.');
    } else if (err.message.includes('301')) {
      logger.error('Public WebSocket got redirected (301). Check URL.');
    } else {
      logger.error('Public WebSocket failed:', err);
    }
  }

  if (!wsConnected) {
    setTimeout(poll, 5000);
    return;
  }

  bot = new Bot(ws, telegramBot);

  // Ping interval
  clearInterval(pingInterval);
  pingInterval = setInterval(() => bot.ping(), 30000);

  // Keep your original initialization line
  ws.on('open', async () => await bot.init());

  // WS events
  ws.on('close', (code) => {
    logger.warn(`WebSocket closed with code: ${code}`);
    clearInterval(pingInterval);
    setTimeout(poll, 5000);
  });

  ws.on('error', (error) => logger.error('WebSocket error:', error));

  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'pong') logger.info(JSON.stringify(msg, null, 4));

      if (msg.type === 'message') bot.sendMessage(msg.message);
      else if (msg.type === 'command') bot.handleCommand(msg);
    } catch (err: any) {
      catchException(err);
    }
  });
};

poll();
