// Expressモジュールのインポート
const express = require('express');

// Vercelに設定した環境変数を取得 (例: 外部サービスへの認証キー)
// 🚨 Vercelダッシュボードで VERCEL_SECRET_KEY を必ず設定してください 🚨
const VERCEL_SECRET_KEY = process.env.VERCEL_SECRET_KEY;

// Expressアプリのインスタンス作成
const app = express();

// ------------------------------------------
// ミドルウェアの設定
// ------------------------------------------

// JSON形式のボディを解析できるようにする（POSTリクエストなどで必須）
app.use(express.json());

// CORS設定（必要に応じて。ここではすべてのオリジンからのアクセスを許可）
// 本番環境では特定のオリジンのみを許可するのが安全です。
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // 適切なドメインに変更してください
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ------------------------------------------
// 実用的なエンドポイントの定義
// ------------------------------------------

// 1. ヘルスチェック/ルートエンドポイント (GET /api)
// サーバーが正常に動作しているか確認用
app.get('/api', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'kaihi-api',
        message: 'API is running successfully on Vercel.',
        timestamp: new Date().toISOString()
    });
});

// 2. お問い合わせ送信エンドポイント (POST /api/contact)
// 外部からのデータを受け取り、処理する例
app.post('/api/contact', (req, res) => {
    const { name, email, message } = req.body;

    // 必須項目のチェック
    if (!name || !email || !message) {
        return res.status(400).json({ 
            error: 'Validation Failed', 
            message: 'Name, email, and message are required fields.' 
        });
    }

    // 環境変数が設定されているかのチェック（本番サービス連携の有無）
    if (!VERCEL_SECRET_KEY) {
        // Vercelログに出力（ユーザーには見えない）
        console.error("Configuration Error: VERCEL_SECRET_KEY is missing for external service.");
        return res.status(503).json({ 
            error: 'Service Unavailable', 
            message: 'External communication key is not set. Contact service administrator.' 
        });
    }

    // 🚨 実際の処理（データベース保存、メール送信API呼び出しなど）はここに記述 🚨
    // 例: sendEmail(name, email, message, VERCEL_SECRET_KEY);
    
    // 成功レスポンス
    res.status(200).json({
        success: true,
        message: `Thank you, ${name}. Your message has been received.`,
        receivedData: { name, email }
    });
});

// ------------------------------------------
// 3. エラー処理
// ------------------------------------------

// 404 (見つからないルート) の処理
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Endpoint ${req.originalUrl} does not exist.`
    });
});

// 最終的なサーバーエラーハンドリング
app.use((err, req, res, next) => {
    console.error('CRITICAL SERVER ERROR:', err.stack); // Vercelログに出力

    res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected server error occurred. Please try again later.'
    });
});

// ------------------------------------------
// 4. Vercelへのエクスポート (必須)
// ------------------------------------------

// Vercelがサーバーレス関数としてアプリケーションを起動するために必要
module.exports = app;
