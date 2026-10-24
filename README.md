# ReelTime 🎬

**ReelTime** is a video-sharing web application inspired by short-form video platforms. Users can sign in, explore a video feed, and upload reels using Supabase.

## 🚀 Features

- 🔐 User authentication with Supabase
- 🎥 Upload video reels
- 📱 Responsive web interface
- 📰 Video feed
- ☁️ Video storage using Supabase Storage
- 📲 Progressive Web App (PWA) installation support
- 🔄 Service worker for caching and app loading
- 🌐 Deployment on Netlify

## 🛠️ Technologies Used

- HTML5
- CSS3
- JavaScript
- Supabase Authentication
- Supabase Database
- Supabase Storage
- Git and GitHub
- Netlify

## 📂 Project Structure

```text
reeltime-starter/
├── index.html
├── style.css
├── instagram-extras.css
├── app.js
├── instagram-extras.js
├── supabase.js
├── manifest.webmanifest
├── sw.js
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   └── apple-touch-icon.png
└── README.md
```

*Note: Update this structure if your actual project contains different files.*

## ⚙️ Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/vishnuballa35-byte/realtime.git
```

### 2. Open the project

Open the project folder in Visual Studio Code.

### 3. Configure Supabase

1. Create a project in the Supabase dashboard.
2. Configure Supabase Authentication.
3. Create the required database tables and security policies.
4. Create a Storage bucket named `reels`.
5. Configure the Supabase URL and publishable key in `supabase.js`.

**Security:** Use only the Supabase project URL and publishable key in frontend code. Never expose a service-role key or other secret credentials.

### 4. Run locally

Use the VS Code Live Server extension or another local web server to run `index.html`.

For authentication redirects and PWA installation, configure the appropriate local and production URLs.

## 🌐 Deployment

ReelTime can be deployed using Netlify or another static hosting service that supports HTTPS.

1. Deploy the project files.
2. Configure the Supabase Site URL and Redirect URLs.
3. Test authentication, video uploads, and feed playback.
4. Verify PWA installation and service-worker behavior.

## 📱 Install as an App

ReelTime is designed to support installation as a Progressive Web App.

- **Android:** Open the HTTPS website in Chrome and select Install app when available.
- **iOS:** Open the website in Safari and select Add to Home Screen.
- **Desktop:** Use the browser's installation option when available.

## 🧪 Testing

Verify the following before releasing updates:

- User signup and login
- Video upload and playback
- Feed loading after refresh
- Supabase Storage permissions
- Installation on mobile devices
- Service-worker caching and updates

## 🔮 Future Improvements

- Like and comment on reels
- Follow and connect with users
- Share reels with other users
- User profiles
- Real-time chat and notifications
- Video calling
- Improved video recommendations

## 👨‍💻 Developer

**Balla Vishnu Vardhan**

- GitHub: [vishnuballa35-byte](https://github.com/vishnuballa35-byte)
- LinkedIn: [Balla Vishnu Vardhan](https://linkedin.com/in/balla-vishnu-vardhan-a57a70400)

## 📄 License

This project is available for learning and development. Add a license file if you intend to distribute or reuse the project under specific terms.


live demo:https://lively-cassata-09ed56.netlify.app/
