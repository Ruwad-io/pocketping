"""Google Gemini provider for AI fallback."""

from pocketping.ai.base import AIProvider
from pocketping.models import Message, Sender


class GeminiProvider(AIProvider):
    """Google Gemini provider."""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-1.5-flash",
    ):
        self.api_key = api_key
        self.model = model
        self._client = None

    @property
    def name(self) -> str:
        return "gemini"

    def _get_client(self):
        if self._client is None:
            try:
                import google.generativeai as genai
            except ImportError:
                raise ImportError("google-generativeai package required. Install with: pip install pocketping[ai]")
            genai.configure(api_key=self.api_key)
            self._client = genai.GenerativeModel(self.model)
        return self._client

    async def generate_response(self, messages: list[Message], system_prompt: str | None = None) -> str:
        model = self._get_client()

        # Build conversation history for Gemini
        history = []
        for msg in messages[:-1]:  # All but last message
            role = "user" if msg.sender == Sender.VISITOR else "model"
            history.append({"role": role, "parts": [msg.content]})

        # Create chat with history
        chat = model.start_chat(history=history)

        # Build the prompt with system instructions
        last_message = messages[-1].content if messages else ""
        prompt = last_message

        if system_prompt and not history:
            prompt = f"{system_prompt}\n\nUser: {last_message}"

        # Generate response
        response = await chat.send_message_async(prompt)

        return response.text

    async def is_available(self) -> bool:
        try:
            self._get_client()
            return True
        except Exception:
            return False
