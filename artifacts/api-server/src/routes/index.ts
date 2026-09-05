import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fareindexRouter from "./fareindex";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fareindexRouter);

export default router;
