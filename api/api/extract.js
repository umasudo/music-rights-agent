export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileData, fileType, fileName } = req.body;

    if (!fileData) {
      return res.status(400).json({ error: 'No file data provided', fallback: true });
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!anthropicApiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      return res.status(500).json({ error: 'API key not configured', fallback: true });
    }

    // Determine content type
    let contentBlocks = [];
    
    if (fileType === 'image') {
      const mediaType = fileName?.endsWith('.png') ? 'image/png' : 'image/jpeg';
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: fileData
        }
      });
    } else if (fileType === 'pdf') {
      contentBlocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: fileData
        }
      });
    } else {
      contentBlocks.push({
        type: 'text',
        text: `Here is the music credits/tracklist:\n\n${fileData}`
      });
    }

    // Add extraction instructions
    contentBlocks.push({
      type: 'text',
      text: `Extract music metadata from this content. Return ONLY valid JSON with no markdown formatting.

CRITICAL RULES:
- NEVER infer dates from biographical context (e.g., "living in Brussels since 2019" is NOT a release year)
- Only extract release years that are explicitly stated as release dates
- If information is ambiguous or conflicting, note it in the appropriate field
- If tracks cannot be parsed cleanly, leave tracks array empty
- Multiple releases should be separate objects in releases array

Required JSON structure:
{
  "artistName": "exact artist name found" or "",
  "email": "email found" or "",
  "releases": [
    {
      "title": "release title if mentioned" or "",
      "year": "YYYY" or "",
      "tracks": ["track 1", "track 2"]
    }
  ],
  "ownsMasters": true or false or null,
  "ownsMastersNote": "explanation if unclear or conflicting",
  "isComposer": true or false or null,
  "isComposerNote": "explanation if unclear or conflicting",
  "warnings": ["list of any ambiguities or parsing issues"]
}

Return ONLY the JSON object, no other text.`
    });

    // Call Claude API
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
          content: contentBlocks
        }]
      })
    });

    if (!claudeResponse.ok) {
      const error = await claudeResponse.text();
      console.error('Claude API error:', error);
      return res.status(500).json({ error: 'Extraction failed', fallback: true });
    }

    const claudeData = await claudeResponse.json();
    
    // Extract text from response
    let extractedText = claudeData.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Clean markdown formatting
    extractedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Parse JSON
    let metadata;
    try {
      metadata = JSON.parse(extractedText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Raw response:', extractedText);
      return res.status(500).json({ error: 'Invalid JSON response', fallback: true });
    }

    return res.status(200).json({
      success: true,
      metadata: metadata
    });

  } catch (error) {
    console.error('Extraction error:', error);
    return res.status(500).json({ error: error.message, fallback: true });
  }
}
