const mysqldump = require("mysqldump");

const backupDatabase = async () => {
  const dumpStream = await mysqldump({
     afterTableCreate: (tableData) => {
      console.log("Detected table:", tableData.name);
    },
    connection: {
      host: process.env.DATABASE_HOST,
      port: process.env.DATABASE_PORT,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE,
    },
    dump: true,
   
  });

  return { dump: dumpStream.dump };
};

module.exports = {
  backupDatabase,
};
