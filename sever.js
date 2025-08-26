import express from "express";
import cors from "cors";
import path from "path";
//import url, { fileURLToPath } from "url";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { askModel, connectMCP } from "./newClient.js";
import fs from "fs";
import { log } from "console";

const port = 3000;
const app = express();
const MONGO_URI = "mongodb://localhost:27017/chatapp1"

// Increase payload limits for file uploads (base64 encoded files can be large)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({
  origin: "http://localhost:5173",  // allow Vite frontend
  credentials: true                // if you're using cookies/auth
}));

app.post("/api/chats", async (req, res) => {
  const { userId, text, files } = req.body;

  if (!userId) {
    return res.status(400).send("User ID is required!");
  }

  try {
    // Generate appropriate title
    const chatTitle = text && text.trim() 
      ? text.substring(0, 40)
      : files && files.length > 0 
        ? `📎 ${files.length} file${files.length > 1 ? 's' : ''} uploaded`
        : "New Chat";

    const newChat = new Chat({
      userId: userId,
      history: [{role:"user", parts: [{ text: text || "" }], files}],
    });

    const savedChat = await newChat.save();


    const userChats = await UserChats.findOne({ userId: userId });


    if (!userChats) {
      const newUserChats = new UserChats({
        userId: userId,
        chats: [
          {
            _id: savedChat._id,
            title: chatTitle,
            createdAt: new Date(), // Explicitly set current timestamp
          },
        ],
      });
      await newUserChats.save();
    } else {

      await UserChats.updateOne(
        { userId: userId },
        {
          $push: {
            chats: {
              _id: savedChat._id,
              title: chatTitle,
              createdAt: new Date(),
            },
          },
        }
      );
    }
    res.status(201).send({_id:savedChat._id,
      messageId:savedChat.history[0].messageId});
    // res.status(201).send(savedChat._id);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error creating chat!");
  }
});


app.get("/api/userchats", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send("User ID is required as a query parameter!");
  }

  try {
    const userChats = await UserChats.findOne({ userId });
    if (userChats) {
      res.status(200).send(userChats.chats);
    } else {
      res.status(200).send([]);
    }
  } catch (err) {
    console.log(err);
    res.status(500).send("Error fetching user chats!");
  }
});


app.get("/api/chats/:id", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send("User ID is required as a query parameter!");
  }

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });
    if (!chat) {
      return res.status(404).send("Chat not found or user mismatch!");
    }
    res.status(200).send(chat);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error fetching chat!");
  }
});


app.put("/api/chats/:id", async (req, res) => {
  const { question, answer, files, userId,messageId } = req.body;

  if (!userId) {
    return res.status(400).send("User ID is required!");
  }

  const newItems = [
    ...(question || (files && files.length > 0)
      ? [{ role: "user", parts: [{ text: question || "" }], ...(files && { files }) }]
      : []),
    { role: "model", parts: [{ text: answer }], messageId },
  ];

  try {
    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      {
        $push: {
          history: {
            $each: newItems,
          },
        },
      }
    );

    // Update timestamp in UserChats for chat ordering
    await UserChats.updateOne(
      { userId: userId, "chats._id": req.params.id },
      {
        $set: {
          "chats.$.createdAt": new Date()
        }
      }
    );

    res.status(200).send(updatedChat);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error adding conversation!");
  }
});

// NEW: Save user message only
app.put("/api/chats/:id/user", async (req, res) => {
  const { question, files, userId } = req.body;

  if (!userId) {
    return res.status(400).send("User ID is required!");
  }

  if (!question && (!files || files.length === 0)) {
    return res.status(400).send("Question or files are required!");
  }

  try {
    const messageId = new mongoose.Types.ObjectId();
    
    const userMessage = {
      messageId: messageId,
      role: "user",
      parts: [{ text: question || "" }],
      timestamp: new Date(),
      ...(files && files.length > 0 && { files })
    };

    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      {
        $push: {
          history: userMessage
        },
      }
    );

    // Update timestamp in UserChats for chat ordering
    await UserChats.updateOne(
      { userId: userId, "chats._id": req.params.id },
      {
        $set: {
          "chats.$.createdAt": new Date()
        }
      }
    );

    res.status(200).send(messageId);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error adding user message!");
  }
});

// NEW: Save AI response only
app.put("/api/chats/:id/ai", async (req, res) => {
  const { answer, userId, messageId } = req.body;

  if (!userId) {
    return res.status(400).send("User ID is required!");
  }

  if (!answer) {
    return res.status(400).send("Answer is required!");
  }

  try {
    const aiMessage = {
      role: "model",
      parts: [{ text: answer }],
      timestamp: new Date(),
      messageId
    };

    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      {
        $push: {
          history: aiMessage
        },
      }
    );

    res.status(200).send(updatedChat);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error adding AI response!");
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send("User ID is required as a query parameter!");
  }

  try {
    // Delete from Chat collection
    const deletedChat = await Chat.findOneAndDelete({ _id: req.params.id, userId });
    
    
    if (!deletedChat) {
      return res.status(404).send("Chat not found or user mismatch!");
    }
    // Remove from UserChats collection
    await UserChats.updateOne(
      { userId: userId },
      {
        $pull: {
          chats: { _id: req.params.id }
        }
      }
    );


    res.status(200).send("Chat deleted successfully!");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error deleting chat!");
  }
});


app.post("/api/mcp/connect", async (req, res) => {
  const {url}=req.body;
  try {
    const connection=await connectMCP(url);
    if(connection.success){
      res.status(200).send({success:true});
    }
    else{
      res.status(400).send({success:false, error: "Failed to connect to MCP"});
    }
  } catch (error) {
    console.log(error);
    res.status(500).send({success:false, error: error.message || error});
  }
})


app.post("/api/mcp/askModel", async (req, res) => {
  const { prompt, model, apiKey, history, files } = req.body;

  try {
    // console.log("Received files in request:", files);
    const result = await askModel(prompt, files, model, apiKey, history);
    res.status(200).send(result);
  } catch (error) {
    console.log(error);
    res.status(500).send({ success: false, error: error.message || error });
  }
 
});

app.get('/api/mcp/servers', async (req,res)=>{
  const servers = JSON.parse(fs.readFileSync("mcp.config.json", "utf-8")).servers;
  res.json(servers);
});

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected successfully to local database');
    app.listen(port, () => console.log(`Server running on port ${port}`));
  })
  .catch((err) => console.error('MongoDB connection error:', err));