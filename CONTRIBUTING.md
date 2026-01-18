# Contributing to PocketPing

First off, thank you for considering contributing to PocketPing! 🎉

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/pocketping.git
cd pocketping
```

2. Install dependencies:
```bash
npm install
```

3. Build all packages:
```bash
npm run build
```

4. Run the example:
```bash
cd examples/node-express
cp .env.example .env
npm run dev
```

## Project Structure

```
pocketping/
├── packages/
│   ├── widget/        # Browser widget (Preact)
│   ├── sdk-node/      # Node.js SDK
│   └── sdk-python/    # Python SDK (planned)
├── bridges/
│   ├── telegram/      # Telegram notifications
│   └── discord/       # Discord notifications (planned)
├── examples/
│   ├── node-express/  # Express.js example
│   ├── python-flask/  # Flask example (planned)
│   └── go-fiber/      # Go Fiber example (planned)
├── protocol/
│   └── spec.yaml      # OpenAPI specification
└── docs/              # Documentation
```

## How to Contribute

### Reporting Bugs

- Check if the bug has already been reported in Issues
- If not, open a new issue with:
  - Clear title and description
  - Steps to reproduce
  - Expected vs actual behavior
  - Environment details (OS, Node version, etc.)

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Be open to discussion about implementation

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Add tests if applicable
5. Commit with clear messages: `git commit -m "Add: my feature"`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

### Commit Messages

We use conventional commits:

- `Add:` New feature
- `Fix:` Bug fix
- `Docs:` Documentation changes
- `Refactor:` Code refactoring
- `Test:` Adding tests
- `Chore:` Maintenance tasks

### Code Style

- Use TypeScript for all JS/TS code
- Follow existing code patterns
- Run `npm run lint` before committing
- Keep PRs focused and small

## Adding a New Bridge

To add support for a new notification channel (e.g., Slack, SMS):

1. Create a new package in `bridges/your-bridge/`
2. Implement the `Bridge` interface from `@pocketping/sdk`
3. Add documentation in the package README
4. Add an example in `examples/`

## Adding SDK for a New Language

1. Create a new package in `packages/sdk-{language}/`
2. Follow the protocol specification in `protocol/spec.yaml`
3. Implement at minimum:
   - Storage interface
   - Protocol handlers
   - Basic documentation

## Questions?

Feel free to open an issue or reach out!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
