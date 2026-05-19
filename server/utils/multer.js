const multer = require('multer');
const path = require('path');

const allowedFormats = ['jpg', 'jpeg', 'png', 'pdf']; // Allow images and PDFs
const maxSize = 5 * 1024 * 1024; // 5MB

const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
  process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name_here' &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_KEY !== 'your_api_key_here';

let storage;

if (isCloudinaryConfigured) {
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  const cloudinary = require('./cloudinary');
  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      let folder = 'general';
      if (req.baseUrl.includes('users')) folder = 'profile_pics';
      if (req.baseUrl.includes('travel')) folder = 'travel_docs';
      if (req.baseUrl.includes('expense')) folder = 'expense_docs';
      return {
        folder,
        resource_type: 'auto',
      };
    },
  });
} else {
  // Use memory storage for clean base64 storage fallback (supports Vercel serverless perfectly)
  storage = multer.memoryStorage();
}

const fileFilter = (req, file, cb) => {
  const ext = file.mimetype.split('/')[1];
  if (allowedFormats.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, JPEG, PNG, and PDF files are allowed!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxSize },
});

// Wrap upload.single to convert req.file to a Base64 data URI when using memory storage fallback
const originalSingle = upload.single;
upload.single = function (fieldName) {
  const middleware = originalSingle.call(upload, fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) return next(err);
      if (req.file && !isCloudinaryConfigured) {
        // Convert memory buffer to Base64 data URL
        const base64Str = req.file.buffer.toString('base64');
        req.file.path = `data:${req.file.mimetype};base64,${base64Str}`;
      }
      next();
    });
  };
};

module.exports = upload; 