import WebSocket from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import { Bot } from './bot';
import { WSMessage } from './types';

let bot: Bot;
let ws: WebSocket;

const close = () => {
  console.log('close server');
  ws.terminate();
  process.exit();
};

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
process.on('exit', () => {
  console.log('exit process');
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
  ws = new WebSocket(process.env.SERVER);
  bot = new Bot(ws, telegramBot);

  ws.on('error', async (error: WebSocket.ErrorEvent) => {
    if (error['code'] === 'ECONNREFUSED') {
      console.log('Waiting for server to be available...');
      setTimeout(poll, 5000);
    } else {
      console.error('%s', error['code']);
    }
  });

  ws.on('open', async () => await bot.init());

  ws.on('close', (code) => {
    if (code === 1005) {
      console.log('disconnected');
    } else if (code === 1006) {
      console.log('terminated');
    }
    //process.exit();
  });

  ws.on('message', (data: string) => {
    const json = JSON.parse(data);
    console.log('message: %s', data);
    if (json.type === 'message') {
      telegramBot.sendMessage(json.message.conversation.id, json.message.content, {
        parse_mode: json.message.extra.format,
        reply_markup: json.message.extra.replyMarkup,
        reply_to_message_id: json.message.reply.id,
      });
    }
  });
};

poll();
