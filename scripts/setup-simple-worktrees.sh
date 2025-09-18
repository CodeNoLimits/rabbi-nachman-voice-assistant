#!/bin/bash

# 🎯 Simple Git Worktree Setup for Multi-Claude Development
set -e

echo "🚀 Setting up Multi-Claude Development Environment"

# Base directory for all worktrees
WORKTREE_BASE="../claude-sessions"
mkdir -p "$WORKTREE_BASE"

# Agent names
agents=("api" "database" "extraction" "chunking" "frontend" "voice" "testing" "deployment")
descriptions=(
    "API endpoints and OpenRouter integration"
    "Database operations and PostgreSQL management"
    "Sefaria text extraction and processing"
    "Semantic chunking and embedding generation"
    "Frontend interface and user experience"
    "Voice recognition and text-to-speech"
    "Automated testing and quality assurance"
    "Deployment and production optimization"
)

# Create worktrees
for i in "${!agents[@]}"; do
    agent="${agents[$i]}"
    description="${descriptions[$i]}"
    branch="claude-${agent}"

    echo "📋 Creating worktree for $branch: $description"

    # Create branch from main
    git checkout -b "$branch" main

    # Create worktree
    git worktree add "$WORKTREE_BASE/$branch" "$branch"

    # Create instructions
    cat > "$WORKTREE_BASE/$branch/AGENT_README.md" << EOF
# 🎯 Claude Agent: $branch

## Mission
$description

## Working Directory
\`$WORKTREE_BASE/$branch\`

## Quick Start
1. \`cd $WORKTREE_BASE/$branch\`
2. \`npm install\`
3. \`./scripts/automated-testing.sh\`

## Files to Focus On
EOF

    # Add specific file focuses
    case $agent in
        "api")
            echo "- src/routes/*.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            echo "- src/services/openrouter.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "database")
            echo "- src/services/database.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            echo "- scripts/setup-database.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "extraction")
            echo "- scripts/extract-sefaria.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "chunking")
            echo "- src/services/chunker.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            echo "- src/services/master-index.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "frontend")
            echo "- public/*.html" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            echo "- public/js/*.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "voice")
            echo "- src/routes/voice.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "testing")
            echo "- test/*.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            echo "- scripts/automated-testing.sh" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
        "deployment")
            echo "- server.js" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            echo "- package.json" >> "$WORKTREE_BASE/$branch/AGENT_README.md"
            ;;
    esac

    echo "✅ Created $branch"
done

# Return to main
git checkout main

echo ""
echo "🎉 Worktree setup complete!"
echo ""
echo "📁 Available Claude sessions:"
for i in "${!agents[@]}"; do
    echo "• $WORKTREE_BASE/claude-${agents[$i]}"
done

echo ""
echo "🚀 To start a Claude session:"
echo "1. cd $WORKTREE_BASE/claude-[agent]"
echo "2. Read AGENT_README.md"
echo "3. Run: ./scripts/automated-testing.sh"