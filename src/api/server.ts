import app from "./app";

const PORT = process.env.PORT
  ? Number(process.env.PORT)
  : 3000;

app.listen(PORT, () => {
  console.log(
    `Friday listening on port ${PORT}`
  );
});