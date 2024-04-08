import WebSocket from 'ws';
import TelegramBot, { Message as TgMessage } from 'node-telegram-bot-api';
import { Conversation, Extra, Message, User, WSInit, WSPing } from './types';
import { Config } from './config';
import { logger } from './utils';

export class Bot {
  websocket: WebSocket;
  bot: TelegramBot;

  constructor(websocket: WebSocket, bot: TelegramBot) {
    this.websocket = websocket;
    this.bot = bot;
  }

  async init() {
    const me = await this.bot.getMe();
    const config: Config = JSON.parse(process.env.CONFIG);
    const data: WSInit = {
      bot: 'polaris',
      platform: 'telegram',
      type: 'init',
      user: {
        id: me.id,
        firstName: me.first_name,
        lastName: null,
        username: me.username,
        isBot: me.is_bot,
      },
      config,
    };
    this.websocket.send(JSON.stringify(data, null, 4));
    logger.info(`Connected as @${me.username}`);
  }

  ping() {
    logger.debug('ping');
    const data: WSPing = {
      bot: 'polaris',
      platform: 'telegram',
      type: 'ping',
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  convertMessage(msg: TgMessage) {
    const id = msg['id'];
    const extra: Extra = {
      originalMessage: msg,
    };

    const conversation = new Conversation(msg.chat.id, msg.chat.title);
    const sender = new User(msg.from.id, msg.from.first_name, msg.from.last_name, msg.from.username, msg.from.is_bot);

    let content;
    let type;

    if (msg.text) {
      content = msg.text;
      type = 'text';
    } else {
      type = 'unsupported';
    }

    /*if (msg.content._ == 'messageText') {
      content = msg.content.text.text;
      type = 'text';
      if (Array.isArray(msg.content.text['entities'])) {
        for (const entity of msg.content.text.entities) {
          if (entity.type._ == 'textEntityTypeUrl') {
            if (!Array.isArray(extra.urls)) {
              extra.urls = [];
            }
            extra.urls.push(content.slice(entity.offset, entity.offset + entity.length));
          }
          if (entity.type._ == 'textEntityTypeMention') {
            if (!Array.isArray(extra.mentions)) {
              extra.mentions = [];
            }
            extra.mentions.push(content.slice(entity.offset, entity.offset + entity.length));
          }
          if (entity.type._ == 'textEntityTypeMentionName') {
            if (!Array.isArray(extra.mentions)) {
              extra.mentions = [];
            }
            extra.mentions.push(entity['user_id']);
          }
          if (entity.type._ == 'textEntityTypeHashtag') {
            if (!Array.isArray(extra.hashtags)) {
              extra.hashtags = [];
            }
            extra.hashtags.push(content.slice(entity.offset, entity.offset + entity.length));
          }
        }
      }
    } else if (msg.content._ == 'messagePhoto') {
      content = msg.content.photo.sizes[0].photo.remote.id;
      type = 'photo';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageAnimation') {
      content = msg.content.animation.animation.remote.id;
      type = 'animation';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageDocument') {
      content = msg.content.document.document.remote.id;
      type = 'document';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageAudio') {
      content = msg.content.audio.audio.remote.id;
      type = 'audio';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageVideo') {
      content = msg.content.video.video.remote.id;
      type = 'video';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageVoiceNote') {
      content = msg.content.voice_note.voice.remote.id;
      type = 'voice';
      if (msg.content.caption) {
        extra.caption = msg.content.caption.text;
      }
    } else if (msg.content._ == 'messageSticker') {
      content = msg.content.sticker.sticker.remote.id;
      type = 'sticker';
    } else if (msg.content._ == 'messageUnsupported') {
      content = 'Message content that is not supported by the client';
      type = 'unsupported';
    } else {
      content = msg.content._;
      type = 'unsupported';
    }*/

    const reply: Message = null;
    /*if (msg['reply_to_message_id'] != undefined && msg['reply_to_message_id'] > 0 && !ignoreReply) {
      reply = await this.getMessage(msg['chat_id'], msg['reply_to_message_id'], true);
    }*/
    if (msg['via_bot_user_id'] != undefined && msg['via_bot_user_id'] > 0) {
      extra.viaBotUserId = msg['via_bot_user_id'];
    }
    if (msg['restriction_reason'] != undefined && msg['restriction_reason'] != '') {
      extra.restrictionReason = msg['restriction_reason'];
    }
    if (msg['reply_markup'] != undefined) {
      extra.replyMarkup = msg['reply_markup'];
    }
    const date = msg['date'];
    return new Message(id, conversation, sender, content, type, date, reply, extra);
  }
}
