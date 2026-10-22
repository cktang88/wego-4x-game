// Minimal types for the parts of `web-push` the server uses (the package ships no types).
declare module 'web-push' {
  interface VapidDetails { subject: string; publicKey: string; privateKey: string }
  interface SendOptions { vapidDetails?: VapidDetails; TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string; timeout?: number; proxy?: string }
  interface SendResult { statusCode: number; body: string; headers: Record<string, string> }
  interface Subscription { endpoint: string; keys: { p256dh: string; auth: string } }
  const webpush: {
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    sendNotification(sub: Subscription, payload?: string | Buffer | null, options?: SendOptions): Promise<SendResult>;
  };
  export default webpush;
}
