const IgApiClient = require('./core/client');
const NavChainManager = require('./core/nav-chain');
const { IgApiClientError } = require('./errors');
const { APP_VERSION } = require('./constants/constants');
const { RealtimeClient, IrisHandshake, SkywalkerProtocol, PresenceManager, DMSender, ErrorHandler, GapHandler, EnhancedDirectCommands, PresenceTypingMixin } = require('./realtime');
const constants = require('./constants/constants');
const sendmedia = require('./sendmedia');
const { useMultiFileAuthState, MultiFileAuthState, extractStateData, applyStateData } = require('./useMultiFileAuthState');
const { downloadContentFromMessage, downloadMediaBuffer, extractMediaUrls, hasMedia, getMediaType, isViewOnceMedia, MEDIA_TYPES } = require('./downloadMedia');
const { GraphQLSubscriptions, QueryIDs } = require('./realtime/subscriptions/graphql.subscription');
const { SkywalkerSubscriptions } = require('./realtime/subscriptions/skywalker.subscription');
let FbnsClient;
try {
  FbnsClient = require('./fbns/fbns.client').FbnsClient;
} catch (e) {
  FbnsClient = class FbnsClient {
    constructor() { throw new Error('FbnsClient requires mqtt-shim dependency which is not installed. Install it with: npm install mqtt-shim'); }
  };
}
const { MQTToTClient, mqttotConnectFlow, INSTAGRAM_VERSION } = require('./mqttot/mqttot.client');
const { MQTToTConnection } = require('./mqttot/mqttot.connection');
const { IgApiClientExt, withFbns, withRealtime, withFbnsAndRealtime } = require('./extend');

const AccountRepository = require('./repositories/account.repository');
const UserRepository = require('./repositories/user.repository');
const MediaRepository = require('./repositories/media.repository');
const FeedRepository = require('./repositories/feed.repository');
const UploadRepository = require('./repositories/upload.repository');
const StoryRepository = require('./repositories/story.repository');
const DirectRepository = require('./repositories/direct.repository');
const DirectThreadRepository = require('./repositories/direct-thread.repository');
const FriendshipRepository = require('./repositories/friendship.repository');
const LocationRepository = require('./repositories/location.repository');
const HashtagRepository = require('./repositories/hashtag.repository');
const NewsRepository = require('./repositories/news.repository');
const CollectionRepository = require('./repositories/collection.repository');
const CloseFriendsRepository = require('./repositories/close-friends.repository');
const HighlightsRepository = require('./repositories/highlights.repository');
const ClipRepository = require('./repositories/clip.repository');
const TimelineRepository = require('./repositories/timeline.repository');
const InsightsRepository = require('./repositories/insights.repository');
const NoteRepository = require('./repositories/note.repository');
const NotificationRepository = require('./repositories/notification.repository');
const SignupRepository = require('./repositories/signup.repository');
const TOTPRepository = require('./repositories/totp.repository');
const BloksRepository = require('./repositories/bloks.repository');
const ChallengeRepository = require('./repositories/challenge.repository');
const ShareRepository = require('./repositories/share.repository');
const TrackRepository = require('./repositories/track.repository');
const ExploreRepository = require('./repositories/explore.repository');
const FBSearchRepository = require('./repositories/fbsearch.repository');
const FundraiserRepository = require('./repositories/fundraiser.repository');
const MultipleAccountsRepository = require('./repositories/multiple-accounts.repository');
const CaptchaRepository = require('./repositories/captcha.repository');

const { SessionHealthMonitor } = require('./realtime/features/session-health-monitor');
const { PersistentLogger } = require('./realtime/features/persistent-logger');

module.exports = {
  IgApiClient,
  NavChainManager,
  IgApiClientError,
  RealtimeClient,
  IrisHandshake,
  SkywalkerProtocol,
  PresenceManager,
  DMSender,
  ErrorHandler,
  GapHandler,
  EnhancedDirectCommands,
  PresenceTypingMixin,
  Topics: constants.Topics,
  REALTIME: constants.REALTIME,
  sendmedia,
  useMultiFileAuthState,
  MultiFileAuthState,
  extractStateData,
  applyStateData,
  downloadContentFromMessage,
  downloadMediaBuffer,
  extractMediaUrls,
  hasMedia,
  getMediaType,
  isViewOnceMedia,
  MEDIA_TYPES,
  GraphQLSubscriptions,
  QueryIDs,
  SkywalkerSubscriptions,
  FbnsClient,
  MQTToTClient,
  mqttotConnectFlow,
  MQTToTConnection,
  INSTAGRAM_VERSION,
  IgApiClientExt,
  withFbns,
  withRealtime,
  withFbnsAndRealtime,
  APP_VERSION,
  SessionHealthMonitor,
  PersistentLogger,
  AccountRepository,
  UserRepository,
  MediaRepository,
  FeedRepository,
  UploadRepository,
  StoryRepository,
  DirectRepository,
  DirectThreadRepository,
  FriendshipRepository,
  LocationRepository,
  HashtagRepository,
  NewsRepository,
  CollectionRepository,
  CloseFriendsRepository,
  HighlightsRepository,
  ClipRepository,
  TimelineRepository,
  InsightsRepository,
  NoteRepository,
  NotificationRepository,
  SignupRepository,
  TOTPRepository,
  BloksRepository,
  ChallengeRepository,
  ShareRepository,
  TrackRepository,
  ExploreRepository,
  FBSearchRepository,
  FundraiserRepository,
  MultipleAccountsRepository,
  CaptchaRepository,
};
