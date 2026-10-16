const form = document.querySelector("#apply-form");
const message = document.querySelector("#application-message");
const messageCount = document.querySelector("#message-count");
const confirmDialog = document.querySelector("#confirm-dialog");

message.addEventListener("input", () => {
  messageCount.textContent = message.value.length;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  confirmDialog.showModal();
});

confirmDialog.addEventListener("click", (event) => {
  if (event.target === confirmDialog) confirmDialog.close();
});
