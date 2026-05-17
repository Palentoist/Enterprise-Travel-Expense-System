const multer = require('multer');
const path = require('path');
const fs = require('fs');

const allowedFormats = ['jpg', 'jpeg', 'png']; // Only images
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
        resource_type: 'image',
        format: file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : file.mimetype.split('/')[1],
      };
    },
  });
} else {
  // Fallback to local disk storage
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });
}

const fileFilter = (req, file, cb) => {
  const ext = file.mimetype.split('/')[1];
  if (allowedFormats.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, JPEG, and PNG image files are allowed!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxSize },
});

// Wrap upload.single to normalize req.file.path to a relative URL for local uploads
const originalSingle = upload.single;
upload.single = function (fieldName) {
  const middleware = originalSingle.call(upload, fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) return next(err);
      if (req.file && !isCloudinaryConfigured) {
        req.file.path = `/uploads/${req.file.filename}`;
      }
      next();
    });
  };
};

module.exports = upload; 