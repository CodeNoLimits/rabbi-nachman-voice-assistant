#!/bin/bash

# 🎯 Git Worktree Setup for 8 Parallel Claude Sessions
# This script creates isolated development environments for each Claude agent

set -e

echo "🚀 Setting up Git Worktree Architecture for Multi-Claude Development"

# Base directory for all worktrees
WORKTREE_BASE="../claude-sessions"
mkdir -p "$WORKTREE_BASE"

# Create 8 specialized branches and worktrees
AGENTS="claude-1-api:API endpoints and OpenRouter integration
claude-2-database:Database operations and PostgreSQL management
claude-3-extraction:Sefaria text extraction and processing
claude-4-chunking:Semantic chunking and embedding generation
claude-5-frontend:Frontend interface and user experience
claude-6-voice:Voice recognition and text-to-speech
claude-7-testing:Automated testing and quality assurance
claude-8-deployment:Deployment and production optimization"

echo "$AGENTS" | while IFS=':' read -r agent description; do
    echo "📋 Creating worktree for $agent: $description"

    # Create branch from main
    git checkout -b "$agent" main

    # Create worktree
    git worktree add "$WORKTREE_BASE/$agent" "$agent"

    # Create agent-specific instructions
    cat > "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md" << EOF
# 🎯 Agent: $agent

## Mission
$description

## Working Directory
\`$WORKTREE_BASE/$agent\`

## Synchronization Rules
1. **Before starting work**: Always pull latest from main
2. **Before committing**: Run automated tests
3. **After completing features**: Push to your branch
4. **Merge coordination**: Use main branch for integration

## Testing Command
\`npm run test:$agent\` (if specific tests exist)

## Status Reporting
Update \`STATUS.md\` in your worktree after each significant change.

## Communication Protocol
- Commit messages must start with "[$agent]"
- Use conventional commits (feat:, fix:, test:, docs:)
- Reference issues with #number

## Files You Should Focus On
EOF

    # Add agent-specific file focus based on specialization
    case $agent in
        "claude-1-api")
            echo "- src/routes/*.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- src/services/openrouter.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- src/index.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-2-database")
            echo "- src/services/database.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- scripts/setup-database.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- src/services/vector-search.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-3-extraction")
            echo "- scripts/extract-sefaria.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- src/services/sefaria-extractor.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-4-chunking")
            echo "- src/services/chunker.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- src/services/master-index.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- scripts/chunk-processor.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-5-frontend")
            echo "- public/*.html" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- public/js/*.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- public/css/*.css" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-6-voice")
            echo "- src/routes/voice.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- src/services/speech.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-7-testing")
            echo "- test/*.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- scripts/test-*.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
        "claude-8-deployment")
            echo "- package.json" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- server.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            echo "- scripts/deploy.js" >> "$WORKTREE_BASE/$agent/CLAUDE_INSTRUCTIONS.md"
            ;;
    esac

    # Create status file
    cat > "$WORKTREE_BASE/$agent/STATUS.md" << EOF
# Status Report - $agent

## Last Updated
$(date)

## Current Tasks
- [ ] Initial setup

## Completed Tasks
- [x] Worktree created

## Blockers
None

## Next Steps
1. Review agent instructions
2. Set up development environment
3. Run initial tests

## Test Results
- Status: Not yet run
- Last Test: Never
- Coverage: Unknown

## Notes
Fresh worktree created. Ready for development.
EOF

    # Create agent-specific package.json scripts
    if [ ! -f "$WORKTREE_BASE/$agent/package.json" ]; then
        cp package.json "$WORKTREE_BASE/$agent/"
    fi

    echo "✅ Worktree $agent created successfully"
done

# Return to main branch
git checkout main

echo "🎉 All worktrees created successfully!"
echo ""
echo "📁 Directory structure:"
echo "$WORKTREE_BASE/"
echo "$AGENTS" | while IFS=':' read -r agent description; do
    echo "├── $agent/"
    echo "│   ├── CLAUDE_INSTRUCTIONS.md"
    echo "│   ├── STATUS.md"
    echo "│   └── [full project files]"
done

echo ""
echo "🚀 To start working in a specific agent worktree:"
echo "cd $WORKTREE_BASE/[agent-name]"
echo ""
echo "🔄 To merge changes back to main:"
echo "git checkout main"
echo "git merge [agent-branch]"
echo ""
echo "📊 To check all agent statuses:"
echo "bash scripts/check-agent-status.sh"