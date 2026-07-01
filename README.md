# Personal Portfolio Website

## About the Project
This is a dynamic and professional personal portfolio website designed to showcase skills, projects, certifications, and achievements. It features a responsive user interface and an integrated admin panel that allows the owner to update the website content in real-time without modifying the source code.

## How It Works
The application is built using a modern web stack:
- **Frontend**: Created with HTML, CSS, and JavaScript to provide a smooth, interactive experience for visitors.
- **Backend**: Powered by Node.js and Express.js to handle data requests and serve the website.
- **Data Storage**: Supports a hybrid data model. It can connect to a cloud MongoDB database to store portfolio data and user uploads securely. If a database is not configured, it automatically falls back to using local JSON files.
- **Admin Panel**: A secure interface where the owner can log in and manage the content. Changes made in the admin panel are immediately reflected on the live public website.
- **Security Architecture**: Implements a strict 3-strike IP blocking system that automatically bans devices after multiple failed login attempts to prevent brute-force attacks. Banned devices can be monitored and unblocked directly from the admin panel.
- **Email Notifications**: Utilizes the Web3Forms HTTP API on the frontend client to reliably bypass strict cloud firewalls (like Render), sending immediate email alerts for new contact form inquiries and successful admin logins.

## Demo Link
[https://my-portfolio-9ihh.onrender.com](https://my-portfolio-9ihh.onrender.com)

## How to Compile and Run Locally

Follow these steps to run the project on your own computer:

### 1. Prerequisites
- Install Node.js on your computer.
- (Optional) Set up a MongoDB account for cloud database storage.

### 2. Installation
Open your terminal or command prompt and run the following commands:
- Clone the repository:
  `git clone https://github.com/atul-232/MY-PORTFOLIO.git`
- Navigate to the project directory:
  `cd MY-PORTFOLIO`
- Install the required dependencies:
  `npm install`

### 3. Configuration
- **With MongoDB**: Set an environment variable named `MONGODB_URI` with your MongoDB connection string. This ensures all your data and uploaded files are saved to the cloud database.
- **Without MongoDB**: If you run the project without setting `MONGODB_URI`, it will automatically use local files to store your data.

### 4. Running the Application
- Start the server by running:
  `node server.js`
- Open your web browser and visit `http://localhost:3000` to see the website.
- To access the admin dashboard, visit `http://localhost:3000/admin`.
