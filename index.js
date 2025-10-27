// index.js
import dotenv from "dotenv";
import server from "./Server.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Proxy server started on port ${PORT}`);
});
