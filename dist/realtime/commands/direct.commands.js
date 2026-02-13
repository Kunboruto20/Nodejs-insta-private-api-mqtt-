"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectCommands = void 0;
const constants_1 = require("../../constants");
const shared_1 = require("../../shared");
const Chance = require("chance");
const thrift_1 = require("../../thrift");

class DirectCommands {
    constructor(client) {
        this.directDebug = (0, shared_1.debugChannel)('realtime', 'direct');
        this.foregroundStateConfig = [
            thrift_1.ThriftDescriptors.boolean('inForegroundApp', 1),
            thrift_1.ThriftDescriptors.boolean('inForegroundDevice', 2),
            thrift_1.ThriftDescriptors.int32('keepAliveTimeout', 3),
            thrift_1.ThriftDescriptors.listOfBinary('subscribeTopics', 4),
            thrift_1.ThriftDescriptors.listOfBinary('subscribeGenericTopics', 5),
            thrift_1.ThriftDescriptors.listOfBinary('unsubscribeTopics', 6),
            thrift_1.ThriftDescriptors.listOfBinary('unsubscribeGenericTopics', 7),
            thrift_1.ThriftDescriptors.int64('requestId', 8),
        ];
        this.client = client;
        this.chance = new Chance();
    }
    async sendForegroundState(state) {
        this.directDebug(`Updated foreground state: ${JSON.stringify(state)}`);
        return this.client
            .publish({
            topic: constants_1.Topics.FOREGROUND_STATE.id,
            payload: await (0, shared_1.compressDeflate)(Buffer.concat([Buffer.alloc(1, 0), (0, thrift_1.thriftWriteFromObject)(state, this.foregroundStateConfig)])),
            qosLevel: 1,
        })
            .then(res => {
            // updating the keepAlive to match the shared value
            if ((0, shared_1.notUndefined)(state.keepAliveTimeout)) {
                this.client.keepAlive = state.keepAliveTimeout;
            }
            return res;
        });
    }
    async sendCommand({ action, data, threadId, clientContext, }) {
        if (clientContext) {
            data.client_context = clientContext;
        }
        const json = JSON.stringify({
            action,
            thread_id: threadId,
            ...data,
        });
        return this.client.publish({
            topic: constants_1.Topics.SEND_MESSAGE.id,
            qosLevel: 1,
            payload: await (0, shared_1.compressDeflate)(json),
        });
    }
    async sendItem({ threadId, itemType, data, clientContext }) {
        return this.sendCommand({
            action: 'send_item',
            threadId,
            clientContext: clientContext || this.chance.guid({ version: 4 }),
            data: {
                item_type: itemType,
                ...data,
            },
        });
    }
    async sendHashtag({ text, threadId, hashtag, clientContext, }) {
        return this.sendItem({
            itemType: 'hashtag',
            threadId,
            clientContext,
            data: {
                text: text || '',
                hashtag,
                item_id: hashtag,
            },
        });
    }
    async sendLike({ threadId, clientContext }) {
        return this.sendItem({
            itemType: 'like',
            threadId,
            clientContext,
            data: {},
        });
    }
    async sendLocation({ text, locationId, threadId, clientContext, }) {
        return this.sendItem({
            itemType: 'location',
            threadId,
            clientContext,
            data: {
                text: text || '',
                venue_id: locationId,
                item_id: locationId,
            },
        });
    }
    async sendMedia({ text, mediaId, threadId, clientContext, }) {
        return this.sendItem({
            itemType: 'media_share',
            threadId,
            clientContext,
            data: {
                text: text || '',
                media_id: mediaId,
            },
        });
    }
    async sendProfile({ text, userId, threadId, clientContext, }) {
        return this.sendItem({
            itemType: 'profile',
            threadId,
            clientContext,
            data: {
                text: text || '',
                profile_user_id: userId,
                item_id: userId,
            },
        });
    }
    async sendReaction({ itemId, reactionType, clientContext, threadId, reactionStatus, targetItemType, emoji, }) {
        return this.sendItem({
            itemType: 'reaction',
            threadId,
            clientContext,
            data: {
                item_id: itemId,
                node_type: 'item',
                reaction_type: reactionType || 'like',
                reaction_status: reactionStatus || 'created',
                target_item_type: targetItemType,
                emoji: emoji || '',
            },
        });
    }
    async sendUserStory({ text, storyId, threadId, clientContext, }) {
        return this.sendItem({
            itemType: 'reel_share',
            threadId,
            clientContext,
            data: {
                text: text || '',
                item_id: storyId,
                media_id: storyId,
            },
        });
    }
    async sendText({ text, clientContext, threadId }) {
        return this.sendItem({
            itemType: 'text',
            threadId,
            clientContext,
            data: {
                text,
            },
        });
    }
    async sendTextViaRealtime(threadId, text, clientContext) {
        return this.sendText({
            text,
            threadId,
            clientContext,
        });
    }
    async markAsSeen({ threadId, itemId }) {
        return this.sendCommand({
            action: 'mark_seen',
            threadId,
            data: {
                item_id: itemId,
            },
        });
    }
    async indicateActivity({ threadId, isActive, clientContext }) {
        return this.sendCommand({
            action: 'indicate_activity',
            threadId,
            clientContext: clientContext || this.chance.guid({ version: 4 }),
            data: {
                activity_status: (typeof isActive === 'undefined' ? true : isActive) ? '1' : '0',
            },
        });
    }
    async sendLink({ link, text, threadId, clientContext }) {
        return this.sendItem({
            itemType: 'link',
            threadId,
            clientContext,
            data: {
                link_text: text || '',
                link_urls: JSON.stringify([link]),
            },
        });
    }
    async sendAnimatedMedia({ id, isSticker, threadId, clientContext }) {
        return this.sendItem({
            itemType: 'animated_media',
            threadId,
            clientContext,
            data: {
                id: id,
                is_sticker: isSticker || false,
            },
        });
    }
    async sendVoice({ uploadId, waveform, waveformSamplingFrequencyHz, threadId, clientContext }) {
        return this.sendItem({
            itemType: 'voice_media',
            threadId,
            clientContext,
            data: {
                upload_id: uploadId,
                waveform: waveform,
                waveform_sampling_frequency_hz: waveformSamplingFrequencyHz || 10,
            },
        });
    }
    async removeReaction({ itemId, threadId, clientContext }) {
        return this.sendItem({
            itemType: 'reaction',
            threadId,
            clientContext,
            data: {
                item_id: itemId,
                node_type: 'item',
                reaction_type: 'like',
                reaction_status: 'deleted',
            },
        });
    }
    async deleteMessage(threadId, itemId) {
        return this.sendCommand({
            action: 'delete_item',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                item_id: itemId,
            },
        });
    }
    async editMessage(threadId, itemId, newText) {
        return this.sendCommand({
            action: 'edit_item',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                item_id: itemId,
                text: newText,
            },
        });
    }
    async replyToMessage(threadId, messageId, replyText) {
        return this.sendItem({
            itemType: 'text',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                text: replyText,
                replied_to_item_id: messageId,
            },
        });
    }
    async addMemberToThread(threadId, userId) {
        return this.sendCommand({
            action: 'add_users',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                user_ids: Array.isArray(userId) ? userId : [userId],
            },
        });
    }
    async removeMemberFromThread(threadId, userId) {
        return this.sendCommand({
            action: 'remove_users',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                user_ids: Array.isArray(userId) ? userId : [userId],
            },
        });
    }
    async leaveThread(threadId) {
        return this.sendCommand({
            action: 'leave',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {},
        });
    }
    async muteThread(threadId, muteUntil = null) {
        return this.sendCommand({
            action: 'mute',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                mute_until: muteUntil,
            },
        });
    }
    async unmuteThread(threadId) {
        return this.sendCommand({
            action: 'unmute',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {},
        });
    }
    async updateThreadTitle(threadId, title) {
        return this.sendCommand({
            action: 'update_title',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                title: title,
            },
        });
    }
    async approveThread(threadId) {
        return this.sendCommand({
            action: 'approve',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {},
        });
    }
    async declineThread(threadId) {
        return this.sendCommand({
            action: 'decline',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {},
        });
    }
    async blockUserInThread(threadId, userId) {
        return this.sendCommand({
            action: 'block',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                user_id: userId,
            },
        });
    }
    async reportThread(threadId, reason) {
        return this.sendCommand({
            action: 'report',
            threadId,
            clientContext: this.chance.guid({ version: 4 }),
            data: {
                reason: reason || 'spam',
            },
        });
    }
    async sendDisappearingPhoto({ uploadId, threadId, viewMode = 'once', clientContext }) {
        return this.sendItem({
            itemType: 'expiring_media_message',
            threadId,
            clientContext,
            data: {
                upload_id: uploadId,
                view_mode: viewMode,
                allow_replay: viewMode === 'replayable',
            },
        });
    }
    async sendDisappearingVideo({ uploadId, threadId, viewMode = 'once', clientContext }) {
        return this.sendItem({
            itemType: 'expiring_media_message',
            threadId,
            clientContext,
            data: {
                upload_id: uploadId,
                view_mode: viewMode,
                allow_replay: viewMode === 'replayable',
                media_type: 2,
            },
        });
    }
    async markVisualMessageSeen({ threadId, itemId, clientContext }) {
        return this.sendCommand({
            action: 'mark_visual_item_seen',
            threadId,
            clientContext: clientContext || this.chance.guid({ version: 4 }),
            data: {
                item_id: itemId,
            },
        });
    }
    async sendScreenshotNotification({ threadId, itemId, clientContext }) {
        return this.sendCommand({
            action: 'screenshot_notification',
            threadId,
            clientContext: clientContext || this.chance.guid({ version: 4 }),
            data: {
                item_id: itemId,
            },
        });
    }
    async sendReplayNotification({ threadId, itemId, clientContext }) {
        return this.sendCommand({
            action: 'replay_notification',
            threadId,
            clientContext: clientContext || this.chance.guid({ version: 4 }),
            data: {
                item_id: itemId,
            },
        });
    }
}
exports.DirectCommands = DirectCommands;
//# sourceMappingURL=direct.commands.js.map
