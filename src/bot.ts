import WebSocket from 'ws';
import TelegramBot, { ChatAction, ParseMode } from 'node-telegram-bot-api';
import { Conversation, Extra, Message, User, WSBroadcast, WSInit, WSPing } from './types';
import { Config } from './config';
import { fromBase64, htmlToMarkdown, isInt, logger, splitLargeMessage } from './utils';
import { Stream } from 'node:stream';

export class Bot {
  user: User;
  config: Config;
  websocket: WebSocket;
  bot: TelegramBot;

  constructor(websocket: WebSocket, bot: TelegramBot) {
    this.websocket = websocket;
    this.bot = bot;
  }

  async init() {
    const me = await this.bot.getMe();
    this.user = {
      id: me.id,
      firstName: me.first_name,
      lastName: null,
      username: me.username,
      isBot: me.is_bot,
    };
    this.config = JSON.parse(process.env.CONFIG);
    const data: WSInit = {
      bot: me.username,
      platform: 'telegram',
      type: 'init',
      user: this.user,
      config: this.config,
    };
    this.websocket.send(JSON.stringify(data, null, 4));
    logger.info(`Connected as @${data.user.username}`);
  }

  ping() {
    logger.debug('ping');
    const data: WSPing = {
      bot: this.user.username,
      platform: 'telegram',
      type: 'ping',
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  broadcast(target: string | string[], chatId: string, content: string, type: string, extra?: Extra) {
    const data: WSBroadcast = {
      bot: this.user.username,
      platform: 'telegram',
      type: 'broadcast',
      target: target,
      message: {
        conversation: new Conversation(chatId),
        content,
        type,
        extra,
      },
    };
    this.websocket.send(JSON.stringify(data, null, 4));
  }

  convertMessage(msg: TelegramBot.Message) {
    const id = msg.message_id;
    const extra: Extra = {
      originalMessage: msg,
    };

    const title = msg.chat.title || `${msg.chat.first_name} ${msg.chat.last_name}`;
    const conversation = new Conversation(msg.chat.id, title);
    const sender = msg.from
      ? new User(msg.from.id, msg.from.first_name, msg.from.last_name, msg.from.username, msg.from.is_bot)
      : conversation;

    let content;
    let type;

    if (msg.text) {
      content = msg.text;
      type = 'text';
      if (Array.isArray(msg.entities)) {
        for (const entity of msg.entities) {
          if (entity.type == 'url') {
            if (!Array.isArray(extra.urls)) {
              extra.urls = [];
            }
            extra.urls.push(content.slice(entity.offset, entity.offset + entity.length));
          }
          if (entity.type == 'mention') {
            if (!Array.isArray(extra.mentions)) {
              extra.mentions = [];
            }
            extra.mentions.push(content.slice(entity.offset, entity.offset + entity.length));
          }
          if (entity.type == 'hashtag') {
            if (!Array.isArray(extra.hashtags)) {
              extra.hashtags = [];
            }
            extra.hashtags.push(content.slice(entity.offset, entity.offset + entity.length));
          }
        }
      }
    } else if (msg.photo) {
      content = msg.photo[0].file_id;
      type = 'photo';
    } else if (msg.animation) {
      content = msg.animation[0].file_id;
      type = 'animation';
    } else if (msg.document) {
      content = msg.document[0].file_id;
      type = 'document';
    } else if (msg.audio) {
      content = msg.audio[0].file_id;
      type = 'audio';
    } else if (msg.video) {
      content = msg.video[0].file_id;
      type = 'video';
    } else if (msg.video_note) {
      content = msg.video_note[0].file_id;
      type = 'video_note';
    } else if (msg.sticker) {
      content = msg.sticker[0].file_id;
      type = 'sticker';
    } else {
      type = 'unsupported';
    }

    if (msg.caption) {
      extra.caption = msg.caption;
    }

    let reply: Message = null;
    if (msg.reply_to_message) {
      reply = this.convertMessage(msg.reply_to_message);
    }
    if (msg.reply_markup != undefined) {
      extra.replyMarkup = msg.reply_markup;
    }
    const date = msg['date'];
    return new Message(id, conversation, sender, content, type, date, reply, extra);
  }

  async sendChatAction(conversationId: number, type = 'text'): Promise<boolean> {
    let action: ChatAction = 'typing';

    if (type == 'photo') {
      action = 'upload_photo';
    } else if (type == 'document') {
      action = 'upload_document';
    } else if (type == 'video') {
      action = 'upload_video';
    } else if (type == 'voice' || type == 'audio') {
      action = 'record_voice';
    } else if (type == 'location' || type == 'venue') {
      action = 'find_location';
    } else if (type == 'cancel') {
      action = null;
    }

    return await this.bot.sendChatAction(conversationId, action);
  }

  async sendMessage(msg: Message): Promise<TelegramBot.Message> {
    await this.sendChatAction(+msg.conversation.id, msg.type);
    let caption = msg.extra?.caption;
    if (msg.extra && msg.extra.format && msg.extra.format === 'HTML') {
      caption = htmlToMarkdown(caption);
    }
    caption = caption?.trim();
    if (msg.type == 'text') {
      if (!msg.content || (typeof msg.content == 'string' && msg.content.length == 0)) {
        return null;
      }
      let preview = false;
      if (msg.extra && 'preview' in msg.extra) {
        preview = msg.extra.preview;
      }
      let text = msg.content;
      text = text.trim();
      if (text.length <= 4096) {
        this.bot.sendMessage(msg.conversation.id, text, {
          parse_mode: msg.extra.format as ParseMode,
          reply_markup: msg.extra?.replyMarkup,
          reply_to_message_id: msg.reply?.id as number,
          disable_web_page_preview: !preview,
        });
      } else {
        const texts = splitLargeMessage(text, 4096);
        for (const split of texts) {
          this.bot.sendMessage(msg.conversation.id, split, {
            parse_mode: msg.extra.format as ParseMode,
            reply_markup: msg.extra?.replyMarkup,
            reply_to_message_id: msg.reply?.id as number,
            disable_web_page_preview: !preview,
          });
        }
      }
    } else if (msg.type == 'photo') {
      this.bot.sendPhoto(msg.conversation.id, await this.getInputFile(msg.content), {
        caption,
        parse_mode: msg.extra.format as ParseMode,
        reply_to_message_id: msg.reply?.id as number,
      });
    } else if (msg.type == 'animation') {
      this.bot.sendAnimation(msg.conversation.id, await this.getInputFile(msg.content), {
        caption,
        parse_mode: msg.extra.format as ParseMode,
        reply_to_message_id: msg.reply?.id as number,
      });
    } else if (msg.type == 'audio') {
      this.bot.sendAudio(msg.conversation.id, await this.getInputFile(msg.content), {
        caption,
        parse_mode: msg.extra.format as ParseMode,
        reply_to_message_id: msg.reply?.id as number,
      });
    } else if (msg.type == 'document') {
      this.bot.sendDocument(msg.conversation.id, await this.getInputFile(msg.content), {
        caption,
        parse_mode: msg.extra.format as ParseMode,
        reply_to_message_id: msg.reply?.id as number,
      });
    } else if (msg.type == 'video') {
      this.bot.sendVideo(msg.conversation.id, await this.getInputFile(msg.content), {
        caption,
        parse_mode: msg.extra.format as ParseMode,
        reply_to_message_id: msg.reply?.id as number,
      });
    } else if (msg.type == 'voice') {
      this.bot.sendVoice(msg.conversation.id, await this.getInputFile(msg.content), {
        caption,
        parse_mode: msg.extra.format as ParseMode,
        reply_to_message_id: msg.reply?.id as number,
      });
    } else if (msg.type == 'sticker') {
      this.bot.sendSticker(msg.conversation.id, await this.getInputFile(msg.content));
    } else if (msg.type == 'forward') {
      this.bot.forwardMessage(msg.extra.conversation, msg.conversation.id, +msg.extra.message);
    }

    return null;
  }

  async getInputFile(content: string): Promise<string | Stream | Buffer> {
    if (content.startsWith('/')) {
      const file = await fromBase64(content);
      return file.name;
    } else if (content.startsWith('http')) {
      return content;
    } else if (isInt(content)) {
      return content;
    } else {
      return content;
    }
  }
}
