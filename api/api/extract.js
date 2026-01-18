// api/extract.js - Vercel Serverless Function
// This handles Claude API calls securely (API key stays server-side)

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileData, fileType, fileName } = req.body;

    // Validate input
    if (!fileData) {
      return res.status(400).json({ error: 'No file data provided' });
    }

    // Determine media type
    let mediaType = 'text/plain';
    let contentType = 'text';
    
    if (fileType === 'image') {
      mediaType = fileName?.endsWith('.png') ? 'image/png' : 'image/jpeg';
      contentType = 'image';
    } else if (fileType === 'pdf') {
      mediaType = 'application/pdf';
      contentType = 'document';
    }

    // Prepare Claude API request
    const claudeMessages = [];

    // Add file content
    if (contentType === 'text') {
      claudeMessages.push({
        type: 'text',
        text: `Here is the music credits/tracklist content:\n\n${fileData}`
      });
    } else {
      claudeMessages.push({
        type: contentType,
        source: {
          type: 'base64',
          media_type: mediaType,
          data: fileData
        }
      });
    }

    // Add extraction instructions
    claudeMessages.push({
      type: 'text',
      text: `You are a careful rights administrator extracting music metadata.

CRITICAL RULES:
1. NEVER infer or guess. Only extract what is explicitly stated.
2. If information is ambiguous or conflicting, mark it as CONFLICTED.
3. If information is missing, return null - do NOT fill gaps.
4. Biographical context (where someone lives, when they moved) is NOT release information.
5. Preserve uncertainty. "maybe" or "might" in source = UNCERTAIN in output.
6. Release years must be explicitly stated as release dates, not biographical dates.
7. Multiple releases = separate records in the releases array.

Return ONLY valid JSON (no markdown, no explanation):

{
  "artist": {
    "name": "artist name if found" or null,
    "email": "email if found" or null
  },
  "releases": [
    {
      "title": "release title if mentioned" or "Untitled Release",
      "type": "EP" | "Single" | "Album" | "UNKNOWN",
      "year": "YYYY" or null,
      "tracks": ["track 1", "track 2"] or []
    }
  ],
  "rights": {
    "masterOwnership": "OWNS" | "DOES_NOT_OWN" | "PARTIAL" | "CONFLICTED" | "UNKNOWN",
    "masterOwnershipNotes": "explanation if conflicted or uncertain",
    "composition": "SOLE" | "CO_WRITTEN" | "CONFLICTED" | "UNKNOWN",
    "compositionNotes": "explanation if conflicted or uncertain"
  },
  "clarificationNeeded": [
    "specific question about ambiguous point"
  ],
  "parsingErrors": [
    "description of what failed to parse"
  ]
}

Examples of CONFLICTED:
- Text says "I own the masters" but also "produced at X Studio under contract" → CONFLICTED
- Text says "I wrote everything" but also "co-produced with Y" → check if co-production = co-writing

Examples of what NOT to extract as release year:
- "living in Brussels since 2019" → NOT a release year
- "started making music in 2020" → NOT a release year
- "Released Summer EP in 2024" → YES, this is a release year

If track extraction fails or produces garbage, add to parsingErrors. Do not return broken data.`
    });

    // Call Claude API
    // NOTE: In production, use environment variable for API key
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicApiKey) {
      return res.status(500).json({ 
        error: 'API key not configured',
        fallback: true 
      });
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: claudeMessages
        }]
      })
    });

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text();
      console.error('Claude API error:', error);
      return res.status(500).json({ 
        error: 'Extraction failed',
        fallback: true 
      });
    }

    const claudeData = await claudeResponse.json();
    
    // Extract JSON from response
    let extractedText = claudeData.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Clean up potential markdown code blocks
    extractedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Parse JSON
    let metadata;
    try {
      metadata = JSON.parse(extractedText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Raw response:', extractedText);
      return res.status(500).json({ 
        error: 'Invalid extraction format',
        fallback: true 
      });
    }

    // Return extracted metadata
    return res.status(200).json({
      success: true,
      metadata: metadata
    });

  } catch (error) {
    console.error('Extraction error:', error);
    return res.status(500).json({ 
      error: error.message,
      fallback: true 
    });
  }
}
