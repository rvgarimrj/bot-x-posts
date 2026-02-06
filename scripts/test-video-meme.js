#!/usr/bin/env node
/**
 * Test Video Meme Pipeline
 * Tests Reddit fetch + download + safety check + caption generation
 *
 * Usage:
 *   node scripts/test-video-meme.js              # Dry run: fetch + download + caption
 *   node scripts/test-video-meme.js --post        # Post a real video meme
 *   node scripts/test-video-meme.js --quote       # Test quote tweet flow
 *   node scripts/test-video-meme.js --all         # Test both pipelines
 *   node scripts/test-video-meme.js [topic]       # Specify topic (crypto, ai, vibeCoding, etc.)
 */

import 'dotenv/config'
import fs from 'fs'
import { fetchRedditMedia } from '../src/sources/reddit-media.js'
import { downloadMedia, checkMediaSafety, downloadThumbnail, cleanupTempMedia } from '../src/media-downloader.js'
import { generateVideoCaption, generateQuoteComment } from '../src/claude-v2.js'
import { searchViralTweets } from '../src/sources/x-viral-search.js'
import { postTweetWithVideo, postTweetWithImage, postQuoteTweet } from '../src/puppeteer-post.js'

const args = process.argv.slice(2)
const shouldPost = args.includes('--post')
const shouldQuote = args.includes('--quote')
const shouldAll = args.includes('--all')
const topic = args.find(a => !a.startsWith('--')) || 'ai'

async function testRedditMeme() {
  console.log('='.repeat(60))
  console.log('🎬 PIPELINE A: Reddit Video Meme')
  console.log('='.repeat(60))
  console.log(`Topic: ${topic}`)
  console.log('')

  // 1. Fetch from Reddit
  console.log('1. Fetching media from Reddit...')
  const media = await fetchRedditMedia(topic, { minScore: 100, limit: 10 })

  if (media.length === 0) {
    console.log('   No media found. Try a different topic.')
    return null
  }

  console.log(`\n   Found ${media.length} media posts:`)
  for (let i = 0; i < Math.min(media.length, 5); i++) {
    const m = media[i]
    console.log(`   ${i + 1}. [${m.mediaType}] "${m.title.substring(0, 50)}..." (r/${m.subreddit}, ${m.score} pts)`)
  }

  // 2. Download first one
  const selected = media[0]
  console.log(`\n2. Downloading: "${selected.title.substring(0, 60)}..."`)
  console.log(`   Type: ${selected.mediaType}`)
  console.log(`   URL: ${selected.mediaUrl.substring(0, 80)}...`)

  const dlResult = await downloadMedia(selected.mediaUrl, selected.mediaType)

  if (!dlResult.success) {
    console.log(`   Download failed: ${dlResult.error}`)

    // Try next one
    if (media.length > 1) {
      console.log('   Trying next media...')
      const alt = media[1]
      const altDl = await downloadMedia(alt.mediaUrl, alt.mediaType)
      if (!altDl.success) {
        console.log(`   Also failed: ${altDl.error}`)
        return null
      }
      Object.assign(selected, alt)
      Object.assign(dlResult, altDl)
    } else {
      return null
    }
  }

  console.log(`   Downloaded: ${dlResult.path} (${Math.round(dlResult.size / 1024)}KB)`)

  // 3. Safety check
  console.log('\n3. Running safety check...')
  if (selected.thumbnailUrl) {
    const thumbResult = await downloadThumbnail(selected.thumbnailUrl)
    if (thumbResult.success) {
      const safetyResult = await checkMediaSafety(thumbResult.path)
      console.log(`   Safety: ${safetyResult.safe ? 'SAFE' : `UNSAFE (${safetyResult.reason})`}`)
      try { fs.unlinkSync(thumbResult.path) } catch {}

      if (!safetyResult.safe) {
        console.log('   Skipping unsafe content.')
        try { fs.unlinkSync(dlResult.path) } catch {}
        return null
      }
    }
  } else {
    console.log('   No thumbnail available, skipping safety check')
  }

  // 4. Generate caption
  console.log('\n4. Generating caption with Claude...')
  const caption = await generateVideoCaption(
    { title: selected.title, subreddit: selected.subreddit, score: selected.score, mediaType: selected.mediaType },
    topic,
    'en'
  )

  console.log(`   Caption: "${caption.text}"`)
  console.log(`   Metadata: hook=${caption._metadata.hook}, style=${caption._metadata.style}`)

  // 5. Post (if --post flag)
  if (shouldPost || shouldAll) {
    console.log('\n5. POSTING...')

    let result
    if (selected.mediaType === 'video') {
      result = await postTweetWithVideo(caption.text, dlResult.path, true)
    } else {
      result = await postTweetWithImage(caption.text, dlResult.path, true)
    }

    if (result.success) {
      console.log('   POSTED SUCCESSFULLY!')
    } else {
      console.log(`   Post failed: ${result.error}`)
    }
  } else {
    console.log('\n5. Dry run (add --post to actually post)')
  }

  // Cleanup
  try { fs.unlinkSync(dlResult.path) } catch {}

  return { selected, caption }
}

async function testQuoteTweet() {
  console.log('\n' + '='.repeat(60))
  console.log('💬 PIPELINE B: X Quote Tweet')
  console.log('='.repeat(60))
  console.log(`Topic: ${topic}`)
  console.log('')

  // 1. Search for viral tweets
  console.log('1. Searching X for viral tweets...')
  const tweets = await searchViralTweets(topic, { limit: 5, minLikes: 50 })

  if (tweets.length === 0) {
    console.log('   No viral tweets found. Chrome may not be connected.')
    return null
  }

  console.log(`\n   Found ${tweets.length} viral tweets:`)
  for (let i = 0; i < tweets.length; i++) {
    const t = tweets[i]
    const mediaTag = t.hasVideo ? '[VIDEO]' : t.hasImage ? '[IMAGE]' : '[TEXT]'
    console.log(`   ${i + 1}. ${mediaTag} @${t.authorHandle} (${t.likes} likes): "${t.text.substring(0, 60)}..."`)
  }

  // 2. Select best tweet
  const selected = tweets[0]
  console.log(`\n2. Selected: @${selected.authorHandle} (${selected.likes} likes)`)
  console.log(`   URL: ${selected.tweetUrl}`)
  console.log(`   Text: "${selected.text.substring(0, 100)}..."`)

  // 3. Generate quote comment
  console.log('\n3. Generating quote comment with Claude...')
  const comment = await generateQuoteComment(
    { text: selected.text, authorHandle: selected.authorHandle, likes: selected.likes },
    topic,
    'en'
  )

  console.log(`   Comment: "${comment.text}"`)
  console.log(`   Metadata: hook=${comment._metadata.hook}, style=${comment._metadata.style}`)

  // 4. Post (if --quote or --all flag)
  if (shouldQuote || shouldAll) {
    console.log('\n4. POSTING QUOTE TWEET...')

    const result = await postQuoteTweet(comment.text, selected.tweetUrl, true)

    if (result.success) {
      console.log('   POSTED SUCCESSFULLY!')
    } else {
      console.log(`   Post failed: ${result.error}`)
    }
  } else {
    console.log('\n4. Dry run (add --quote to actually post)')
  }

  return { selected, comment }
}

async function main() {
  console.log('🧪 Test: Viral Media Posts Pipeline')
  console.log(`Topic: ${topic}`)
  console.log(`Flags: ${shouldPost ? '--post ' : ''}${shouldQuote ? '--quote ' : ''}${shouldAll ? '--all ' : ''}`)
  console.log('')

  if (!shouldQuote || shouldAll) {
    await testRedditMeme()
  }

  if (shouldQuote || shouldAll) {
    await testQuoteTweet()
  }

  if (!shouldPost && !shouldQuote && !shouldAll) {
    console.log('\n' + '='.repeat(60))
    console.log('Add --post to post a meme, --quote to post a quote tweet, --all for both')
  }

  cleanupTempMedia()
  console.log('\nDone!')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
