import { TwitterApi } from 'twitter-api-v2'

export function createTwitterClient() {
  return new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  })
}

export async function postTweet(client, text) {
  const { data } = await client.v2.tweet(text)
  return {
    id: data.id,
    text: data.text,
    url: `https://x.com/${process.env.X_USERNAME}/status/${data.id}`
  }
}

export async function verifyCredentials(client) {
  const me = await client.v1.verifyCredentials()
  return { id: me.id_str, username: me.screen_name, name: me.name }
}
