const normalize = (data) => {
  if (typeof data !== "string") {
    return undefined;
  }

  return data?.trim() || "";
};

module.exports = { normalize };
