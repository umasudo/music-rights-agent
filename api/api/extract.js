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
      text: `Extract music metadata from this content and return ONLY a valid JSON object (no markdown, no explanation).

Required format:
{
  "artistName": "artist name if found, empty string if not",
  "email": "email if found, empty string if not",
  "releaseYears": "year or year range if found (e.g. '2024' or '2023-2024'), empty string if not",
  "ownsMasters": true/false/null (true if text mentions owning masters/produced by artist, false if label mentioned, null if unclear),
  "isComposer": true/false/null (true if mentions written by/composed by artist, false if co-written, null if unclear),
  "tracks": ["array", "of", "track", "titles", "found"],
  "notes": "any additional relevant information about roles, collaborators, or ownership"
}

Be generous in extraction - if something looks like a track title, include it. If ownership is implied, mark it true.`
    });

    // Call Claude API
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
