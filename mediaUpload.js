// backend/utils/mediaUpload.js
//
// Single shared entry point for pushing an image buffer to CoinGabbarSignals's
// existing media store (ImgBB). Both routes/upload.js (generic article/
// author image picker) and the Advertising Creatives module call this
// same function — there is intentionally only one place in the backend
// that talks to ImgBB, so nothing new is duplicated here.

const axios = require('axios');
const FormData = require('form-data');

/**
 * Upload a raw file buffer to ImgBB and return the hosted URL.
 * @param {Buffer} buffer - raw file bytes
 * @param {string} [name] - optional filename hint for the upload
 * @returns {Promise<string>} the hosted image URL
 */
async function uploadBufferToImgbb(buffer, name) {
  const form = new FormData();
  form.append('image', buffer.toString('base64'));
  if (name) form.append('name', name);

  const response = await axios.post(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    form,
    { headers: form.getHeaders() }
  );

  if (!response.data || !response.data.data || !response.data.data.url) {
    throw new Error('Upload succeeded but no URL was returned');
  }

  return response.data.data.url;
}

module.exports = { uploadBufferToImgbb };
