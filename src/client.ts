import WebSocket from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import { Bot } from './bot';
import { WSMessage } from './types';
import { catchException, logger } from './utils';

let bot: Bot;
let ws: WebSocket;
let pingInterval;

logger.debug(`SERVER: ${process.env.SERVER}`);
logger.debug(`TOKEN: ${process.env.TOKEN}`);
logger.debug(`CONFIG: ${process.env.CONFIG}`);

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

// Create a bot that uses 'polling' to fetch new updates
const telegramBot = new TelegramBot(process.env.TOKEN, { polling: true });

telegramBot.on('message', (message) => {
  const msg = bot.convertMessage(message);
  const data: WSMessage = {
    bot: 'polaris',
    platform: 'telegram',
    type: 'message',
    message: msg,
  };
  ws.send(JSON.stringify(data, null, 4));
});

const poll = () => {
  logger.info('Starting polling...');
  ws = new WebSocket(process.env.SERVER);
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
      logger.error(error['code']);
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
      logger.info(data);
      if (msg.type === 'message') {
        telegramBot.sendMessage(msg.message.conversation.id, msg.message.content, {
          parse_mode: msg.message.extra?.format,
          reply_markup: msg.message.extra?.replyMarkup,
          reply_to_message_id: msg.message.reply?.id,
        });
      }
    } catch (error) {
      catchException(error);
    }
  });
};

poll();
