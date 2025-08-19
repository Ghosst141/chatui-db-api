import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openAIModels, geminiModels, claudeModels, grokModels } from "./Models.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGroq } from "@langchain/groq";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import { tool, DynamicStructuredTool } from "@langchain/core/tools";


let mcpClient = null;
let chatModel = null;
let currentMCPUrl = null; // track manually

async function connectMCP(url) {
  try {
    console.log("Connecting to MCP at:", url);
    const transport = new StreamableHTTPClientTransport(new URL(url));

    if (!mcpClient) {
      mcpClient = new Client({ name: "MCP Client", version: "1.0.0" });
      await mcpClient.connect(transport);
      currentMCPUrl = url; // save url
    } else {
      console.log("already used url", currentMCPUrl);
      console.log("trying to connect to", url);

      if (currentMCPUrl !== url) {
        await mcpClient.disconnect();
        mcpClient = new Client({ name: "MCP Client", version: "1.0.0" });
        await mcpClient.connect(transport);
        currentMCPUrl = url;
      } else {
        console.log("MCP Client is already connected to the correct URL.");
      }
    }

    return { success: true, client: mcpClient };
  } catch (error) {
    console.error("Error connecting to MCP:", error);
    return { success: false, error: error.message || error };
  }
}

async function getTools(modelType) {
  if (!mcpClient) {
    throw new Error("MCP Client is not connected.");
  }
  const { tools: mcpTools } = await mcpClient.listTools();
  if (!mcpTools || mcpTools.length === 0) {
    console.warn("No tools found in MCP.");
    return [];
  }

  if (modelType === "gemini") {
    // Wrap in LangChain DynamicStructuredTool
    return mcpTools.map(
      (t) =>
        new DynamicStructuredTool({
          name: t.name,
          description: t.description || "",
          schema: z.object(
            Object.fromEntries(
              Object.entries(t.inputSchema?.properties || {}).map(([k, v]) => [
                k,
                z.string().describe(v.description || ""),
              ])
            )
          ),
          func: async (args) => {
            const result = await mcpClient.callTool({
              name: t.name,
              arguments: args,
            });
            return result?.content?.[0]?.text ?? JSON.stringify(result);
          },
        })
    );
  }

  // Default OpenAI-style tools
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description || "",
    parameters: t.inputSchema || { type: "object", properties: {} },
  }));
}

async function askModel(prompt, modelName, apiKey) {
  if (!mcpClient) {
    throw new Error("MCP Client is not connected. Please connect first.");
  }

  if (!apiKey || apiKey.trim() === "") {
    return {
      success: false,
      type: "error",
      content: `No API key provided for model: ${modelName}`,
      history: [],
    };
  }

  if (openAIModels.includes(modelName)) {
    chatModel = new ChatOpenAI({ model: modelName, openAIApiKey: apiKey });
  } else if (geminiModels.includes(modelName)) {
    chatModel = new ChatGoogleGenerativeAI({ model: modelName, apiKey });
  } else if (claudeModels.includes(modelName)) {
    chatModel = new ChatAnthropic({ model: modelName, apiKey });
  } else if (grokModels.includes(modelName)) {
    chatModel = new ChatGroq({ model: modelName, apiKey });
  } else {
    throw new Error(`Unsupported model: ${modelName}`);
  }

  const isGemini = geminiModels.includes(modelName);
  const mcpTools = await getTools(isGemini ? "gemini" : "default");

  const modelWithTools =
    mcpTools.length > 0 ? chatModel.bindTools(mcpTools) : chatModel;

  const messages = [new HumanMessage(prompt)];

  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return {
        success: true,
        type: "final",
        content: response.content, // final text for UI
        history: messages.map((m) => ({ role: m._getType(), content: m.content })),
      };
    }

    const toolMessages = [];
    for (const toolCall of response.tool_calls) {
      try {
        const toolResult = await mcpClient.callTool({
          name: toolCall.name,
          arguments: toolCall.args,
        });

        const toolOutput = toolResult?.content?.[0]?.text ?? JSON.stringify(toolResult);

        toolMessages.push(
          new ToolMessage({
            content: toolOutput,
            tool_call_id: toolCall.id,
          })
        );

        messages.push(
          new ToolMessage({
            content: toolOutput,
            tool_call_id: toolCall.id,
          })
        );
      } catch (e) {
        toolMessages.push(
          new ToolMessage({
            content: `Error: ${e instanceof Error ? e.message : String(e)}`,
            tool_call_id: toolCall.id,
          })
        );
      }
    }
  }

  return {
    success: false,
    type: "stopped",
    content: "Agent stopped after reaching max turns.",
    history: messages.map((m) => ({ role: m._getType(), content: m.content })),
  };
}

export { connectMCP, askModel };
