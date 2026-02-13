const sendPhoto = require('./sendPhoto');
const sendFile = require('./sendFile');
const uploadPhoto = require('./uploadPhoto');
const uploadFile = require('./uploadfFile');
const sendRavenPhoto = require('./sendRavenPhoto');
const sendRavenVideo = require('./sendRavenVideo');
const sendViewOncePhoto = sendRavenPhoto;
const sendViewOnceVideo = sendRavenVideo;

module.exports = {
  sendPhoto,
  sendFile,
  uploadPhoto,
  uploadFile,
  sendRavenPhoto,
    sendViewOncePhoto,
  sendViewOnceVideo,

  sendRavenVideo,
};
