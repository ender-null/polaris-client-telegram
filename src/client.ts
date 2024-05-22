import WebSocket from 'ws';
import TelegramBot from 'node-telegram-bot-api';
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

const poll = () => {
  logger.info('Starting polling...');
  ws = new WebSocket(String(process.env.SERVER));
  bot = new Bot(ws, telegramBot);

  clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    bot.ping();
  }, 30000);

  ws.on('error', async (error: WebSocket.ErrorEvent) => {
    if (error['code'] === 'ECONNREFUSED') {
      logger.info(`Waiting for server to be available...`);
      setTimeout(poll, 5000);
    } else {
      logger.error(error);
    }
  });

  ws.on('open', async () => await bot.init());

  ws.on('close', (code) => {
    if (code === 1005) {
      logger.warn(`Disconnected`);
    } else if (code === 1006) {
      logger.warn(`Terminated`);
    }
    clearInterval(pingInterval);
    process.exit();
  });

  ws.on('message', (data: string) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'pong') {
        logger.info(JSON.stringify(msg, null, 4));
      }
      if (msg.type === 'message') {
        bot.sendMessage(msg.message);
      } else if (msg.type === 'command') {
        bot.handleCommand(msg);
      }
    } catch (error: any) {
      catchException(error);
    }
  });
};

poll();
